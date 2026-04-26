-- ============================================================
-- ZESTO OS — Schema v17
-- Inline autosave para artigos single-packaging (Fase C1)
-- ============================================================
--
-- Contexto:
--   O Inventário precisa de permitir contagem inline (sem expansão
--   nem botão Guardar) para artigos com 1 única embalagem. Isto
--   exige:
--
--     1. Saber, em current_stock, quantas embalagens distintas
--        existem por artigo + qual é a label/base_per_unit do
--        único packaging quando count = 1.
--
--     2. Um RPC idempotente por sessão de contagem que actualiza
--        sempre o mesmo stock_movement em vez de criar um novo
--        a cada autosave. Caso contrário o histórico fica poluído
--        com vários ADJUSTMENTs para a mesma intenção de contagem.
--
-- Esta migration:
--
--   1. Adiciona coluna count_session_id em stock_movements
--      (NULL para movements antigos e PURCHASE/etc; só preenchido
--      por record_stock_count_inline).
--
--   2. Cria índice único parcial:
--      UNIQUE (organization_id, article_id, count_session_id)
--      WHERE count_session_id IS NOT NULL
--
--   3. Cria função _article_packaging_summary(uuid) que replica
--      a mesma união sizes ∪ suppliers ∪ fallback de
--      article_packagings (016) e devolve count + label/base
--      quando count = 1.
--
--   4. Recria current_stock com 3 colunas novas:
--      - packaging_count INT
--      - single_packaging_label TEXT
--      - single_packaging_base_per_unit NUMERIC
--      Recria também order_suggestions (depende de current_stock).
--      Repõe security_invoker=true em ambas (DROP+CREATE perde-o).
--
--   5. Cria RPC record_stock_count_inline(p_article_id, p_qty,
--      p_session_id) com:
--      - Validação: artigo existe, packaging_count = 1, qty >= 0,
--        session_id não-NULL.
--      - Procura SELECT ... FOR UPDATE do existing movement na
--        sessão para serializar concurrent writes.
--      - Cálculo de baseline = current_qty - existing_quantity
--        para isolar a contribuição desta sessão.
--      - UPDATE in-place se existe; senão INSERT.
--      - Tratamento interno de unique_violation: se INSERT colide
--        com índice único (race entre 2 calls), re-fetch, recalcula
--        baseline e faz UPDATE in-place. Cliente nunca vê o erro.
--      - DELETE/INSERT de stock_count_lines (sempre 1 linha).
--      - No-op se delta inalterado (< 0.0001).
--
-- Compatibilidade:
--   - record_stock_count (016) intacto. Caminho multi-embalagem
--     não é tocado.
--   - Movimentos antigos têm count_session_id = NULL e não são
--     afectados pelo índice parcial.
--   - article_packagings (016) intacto.
--   - SECURITY INVOKER em ambas as funções: RLS aplica via
--     current_org_id() naturalmente. Cliente nunca passa
--     organization_id (trigger trg_set_org_stock_movements
--     em INSERT; UPDATE preserva organization_id existente).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Coluna count_session_id + índice único parcial
-- ------------------------------------------------------------
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS count_session_id UUID NULL;

COMMENT ON COLUMN stock_movements.count_session_id IS
  'Identificador da sessão de contagem inline. NULL para movements antigos e tipos não-ADJUSTMENT-inline. Permite UPDATE in-place no autosave inline.';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_stock_movements_org_article_session
  ON stock_movements (organization_id, article_id, count_session_id)
  WHERE count_session_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Função helper: _article_packaging_summary
--    Replica união+dedup de article_packagings (016) e
--    agrega para devolver 1 linha por artigo:
--      packaging_count                INT     (sempre >= 1 para artigos visíveis)
--      single_packaging_label         TEXT    (NULL se count <> 1)
--      single_packaging_base_per_unit NUMERIC (NULL se count <> 1)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION _article_packaging_summary(p_article_id UUID)
RETURNS TABLE(
  packaging_count                INT,
  single_packaging_label         TEXT,
  single_packaging_base_per_unit NUMERIC
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  WITH base AS (
    SELECT a.unit
    FROM articles a
    WHERE a.id = p_article_id
  ),
  sizes AS (
    SELECT
      s.label::TEXT                        AS label,
      s.base_per_unit::NUMERIC             AS base_per_unit,
      (100 + COALESCE(s.sort_order, 0))::INT AS sort_key
    FROM article_sizes s
    WHERE s.article_id = p_article_id
  ),
  suppliers AS (
    SELECT
      ars.order_unit::TEXT                                  AS label,
      ars.conversion_factor::NUMERIC                        AS base_per_unit,
      (CASE WHEN ars.is_preferred THEN 200 ELSE 250 END)::INT AS sort_key
    FROM article_suppliers ars
    WHERE ars.article_id = p_article_id
      AND ars.order_unit IS NOT NULL
      AND ars.conversion_factor > 0
  ),
  fallback AS (
    SELECT
      CASE b.unit
        WHEN 'g'  THEN 'kg solto'
        WHEN 'mL' THEN 'L solto'
        WHEN 'kg' THEN 'kg solto'
        WHEN 'L'  THEN 'L solto'
        WHEN 'un' THEN 'un solto'
        ELSE b.unit || ' solto'
      END                                            AS label,
      (CASE b.unit WHEN 'g' THEN 1000 WHEN 'mL' THEN 1000 ELSE 1 END)::NUMERIC AS base_per_unit,
      900::INT                                       AS sort_key
    FROM base b
  ),
  unioned AS (
    SELECT * FROM sizes
    UNION ALL SELECT * FROM suppliers
    UNION ALL SELECT * FROM fallback
  ),
  deduped AS (
    SELECT DISTINCT ON (lower(label), base_per_unit)
      label, base_per_unit, sort_key
    FROM unioned
    ORDER BY lower(label), base_per_unit, sort_key
  )
  SELECT
    COUNT(*)::INT,
    CASE WHEN COUNT(*) = 1 THEN MIN(label)         END,
    CASE WHEN COUNT(*) = 1 THEN MIN(base_per_unit) END
  FROM deduped;
$$;

COMMENT ON FUNCTION _article_packaging_summary(UUID) IS
  'Sumário de embalagens para current_stock: count + label/base_per_unit quando count=1. Replica união sizes∪suppliers∪fallback de article_packagings.';

-- ------------------------------------------------------------
-- 3. Recriar current_stock com 3 colunas novas + order_suggestions
-- ------------------------------------------------------------
DROP VIEW IF EXISTS order_suggestions;
DROP VIEW IF EXISTS current_stock;

CREATE VIEW current_stock AS
SELECT
  a.id                                                       AS article_id,
  a.name,
  a.unit,
  COALESCE(ars.order_unit, sz.label, a.unit)                 AS stock_unit,
  a.par_level,
  a.category,
  COALESCE(ars.conversion_factor, sz.base_per_unit, 1)       AS base_per_stock,
  COALESCE(SUM(sm.quantity), 0)                              AS current_qty,
  COALESCE(SUM(sm.quantity), 0) - a.par_level                AS diff_from_par,
  pkg.packaging_count,
  pkg.single_packaging_label,
  pkg.single_packaging_base_per_unit
FROM articles a
LEFT JOIN stock_movements sm ON sm.article_id = a.id
LEFT JOIN article_suppliers ars
  ON ars.article_id = a.id
  AND ars.is_preferred = TRUE
LEFT JOIN LATERAL (
  SELECT s.label, s.base_per_unit
  FROM article_sizes s
  WHERE s.article_id = a.id
  ORDER BY s.sort_order ASC, s.created_at ASC
  LIMIT 1
) sz ON TRUE
LEFT JOIN LATERAL _article_packaging_summary(a.id) pkg ON TRUE
WHERE a.is_active = TRUE
GROUP BY
  a.id, a.name, a.unit, a.par_level, a.category,
  ars.order_unit, ars.conversion_factor,
  sz.label, sz.base_per_unit,
  pkg.packaging_count, pkg.single_packaging_label, pkg.single_packaging_base_per_unit;

CREATE VIEW order_suggestions AS
SELECT
  cs.article_id,
  cs.name,
  cs.unit,
  cs.par_level,
  cs.current_qty,
  cs.diff_from_par,
  GREATEST(cs.par_level - cs.current_qty, 0)              AS qty_to_order,
  ars.supplier_id,
  s.name                                                   AS supplier_name,
  ars.order_unit,
  ars.price,
  ars.conversion_factor,
  CASE
    WHEN ars.conversion_factor > 0
    THEN CEIL(GREATEST(cs.par_level - cs.current_qty, 0) / ars.conversion_factor)
    ELSE 0
  END                                                      AS order_qty_in_order_unit
FROM current_stock cs
LEFT JOIN article_suppliers ars
  ON ars.article_id = cs.article_id AND ars.is_preferred = TRUE
LEFT JOIN suppliers s ON s.id = ars.supplier_id
WHERE cs.current_qty < cs.par_level
  AND NOT EXISTS (
    SELECT 1
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.article_id = cs.article_id
      AND o.status IN ('DRAFT', 'SENT')
  );

ALTER VIEW current_stock     SET (security_invoker = true);
ALTER VIEW order_suggestions SET (security_invoker = true);

-- ------------------------------------------------------------
-- 4. RPC record_stock_count_inline
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_stock_count_inline(
  p_article_id UUID,
  p_qty        NUMERIC,
  p_session_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_unit            TEXT;
  v_pkg_count       INT;
  v_label           TEXT;
  v_base_per_unit   NUMERIC;
  v_existing_id     UUID;
  v_existing_qty    NUMERIC;
  v_baseline        NUMERIC;
  v_new_qty         NUMERIC;
  v_total_base      NUMERIC;
BEGIN
  -- 1. Resolver artigo + summary (RLS aplica via SECURITY INVOKER)
  SELECT a.unit, pkg.packaging_count,
         pkg.single_packaging_label, pkg.single_packaging_base_per_unit
    INTO v_unit, v_pkg_count, v_label, v_base_per_unit
  FROM articles a, _article_packaging_summary(a.id) pkg
  WHERE a.id = p_article_id;

  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'Article % not found or not accessible', p_article_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- 2. Validar input
  IF v_pkg_count <> 1 THEN
    RAISE EXCEPTION 'Inline autosave only valid for single-packaging articles (count=%)', v_pkg_count
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_qty IS NULL OR p_qty < 0 THEN
    RAISE EXCEPTION 'p_qty must be >= 0'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'p_session_id required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_total_base := p_qty * v_base_per_unit;

  -- 3. Procura existing na mesma sessão (lock contra concurrent writes)
  SELECT id, quantity INTO v_existing_id, v_existing_qty
  FROM stock_movements
  WHERE article_id = p_article_id
    AND count_session_id = p_session_id
    AND type = 'ADJUSTMENT'
  FOR UPDATE;

  -- 4. Calcular baseline (current_qty sem a contribuição desta sessão)
  --    e novo delta a registar.
  SELECT current_qty INTO v_baseline FROM current_stock WHERE article_id = p_article_id;
  v_baseline := COALESCE(v_baseline, 0) - COALESCE(v_existing_qty, 0);
  v_new_qty  := v_total_base - v_baseline;

  -- 5a. Existe → UPDATE in-place
  IF v_existing_id IS NOT NULL THEN
    IF abs(v_new_qty - v_existing_qty) < 0.0001 THEN
      RETURN v_existing_id;
    END IF;

    UPDATE stock_movements
       SET quantity   = v_new_qty,
           counted_at = NOW(),
           notes      = 'Contagem inline (1 embalagem) — auto-save'
     WHERE id = v_existing_id;

    DELETE FROM stock_count_lines WHERE movement_id = v_existing_id;
    INSERT INTO stock_count_lines (movement_id, size_label, qty, base_per_unit, base_qty)
    VALUES (v_existing_id, v_label, p_qty, v_base_per_unit, v_total_base);

    RETURN v_existing_id;
  END IF;

  -- 5b. Não existe → INSERT inicial
  --     Idempotência interna: se 2 calls concorrentes fizeram SELECT vazio,
  --     ambas tentam INSERT. A segunda apanha unique_violation, faz re-fetch,
  --     recalcula baseline e UPDATE in-place. Cliente não precisa retry.
  IF abs(v_new_qty) < 0.0001 THEN
    -- Delta zero e não há existing → no-op. Cliente trata "no error" como sucesso
    -- e marca artigo como contado mesmo sem movement_id.
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO stock_movements
      (article_id, type, quantity, unit, notes, counted_at, count_session_id)
    VALUES
      (p_article_id, 'ADJUSTMENT', v_new_qty, v_unit,
       'Contagem inline (1 embalagem) — auto-save', NOW(), p_session_id)
    RETURNING id INTO v_existing_id;

    INSERT INTO stock_count_lines (movement_id, size_label, qty, base_per_unit, base_qty)
    VALUES (v_existing_id, v_label, p_qty, v_base_per_unit, v_total_base);

    RETURN v_existing_id;
  EXCEPTION WHEN unique_violation THEN
    -- Concurrent INSERT venceu. Re-fetch a linha vencedora (with lock),
    -- recalcula baseline e novo delta, e faz UPDATE in-place.
    SELECT id, quantity INTO v_existing_id, v_existing_qty
    FROM stock_movements
    WHERE article_id = p_article_id
      AND count_session_id = p_session_id
      AND type = 'ADJUSTMENT'
    FOR UPDATE;

    IF v_existing_id IS NULL THEN
      -- Defensivo: índice disparou mas não encontramos a linha.
      -- Pode acontecer se outra org tem o mesmo session_id (improvável com UUID v4)
      -- e o RLS oculta. Re-raise.
      RAISE;
    END IF;

    SELECT current_qty INTO v_baseline FROM current_stock WHERE article_id = p_article_id;
    v_baseline := COALESCE(v_baseline, 0) - COALESCE(v_existing_qty, 0);
    v_new_qty  := v_total_base - v_baseline;

    IF abs(v_new_qty - v_existing_qty) < 0.0001 THEN
      RETURN v_existing_id;
    END IF;

    UPDATE stock_movements
       SET quantity   = v_new_qty,
           counted_at = NOW(),
           notes      = 'Contagem inline (1 embalagem) — auto-save'
     WHERE id = v_existing_id;

    DELETE FROM stock_count_lines WHERE movement_id = v_existing_id;
    INSERT INTO stock_count_lines (movement_id, size_label, qty, base_per_unit, base_qty)
    VALUES (v_existing_id, v_label, p_qty, v_base_per_unit, v_total_base);

    RETURN v_existing_id;
  END;
END;
$$;

COMMENT ON FUNCTION record_stock_count_inline(UUID, NUMERIC, UUID) IS
  'Autosave inline single-packaging idempotente por session_id. UPDATE in-place se existe; INSERT senão. Apanha unique_violation interno (race) → re-fetch + UPDATE. RLS via SECURITY INVOKER.';
