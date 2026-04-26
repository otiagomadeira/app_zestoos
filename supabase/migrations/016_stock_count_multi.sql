-- ============================================================
-- ZESTO OS — Schema v16
-- Contagem de stock multi-embalagem
-- ============================================================
--
-- Contexto:
--   O Inventário precisa de permitir contar 1 artigo em N embalagens
--   na mesma sessão (ex.: Rúcula = 1×saco200g + 2×saco500g + 4×kg).
--   A DB já tem stock_count_lines (005) e article_sizes (006/013) para
--   este caso, mas o código nunca chegou a usá-los.
--
-- Esta migration adiciona DUAS funções e nada mais:
--
--   1. article_packagings(p_article_id)
--      Devolve as embalagens disponíveis para um artigo, vindas de
--      article_sizes ∪ article_suppliers ∪ fallback solto.
--      Dedup por (lower(label), base_per_unit) — preserva colisões
--      legítimas com bases diferentes (saco 5kg vs saco 25kg).
--
--   2. record_stock_count(p_article_id, p_lines)
--      Atómico: 1 stock_movement ADJUSTMENT + N stock_count_lines.
--      Calcula total = SUM(qty × base_per_unit), delta vs current_stock,
--      no-op se |delta| < 0.0001.
--
-- Compatibilidade:
--   - Não altera tabelas, views, triggers ou RLS policies existentes
--   - Não toca em order_suggestions nem em Encomendas
--   - SECURITY INVOKER em ambas as funções: RLS aplica naturalmente
--     via current_org_id() (organization_id é injetado pelos triggers
--     trg_set_org_stock_movements e trg_set_org_stock_count_lines)
-- ============================================================

-- ------------------------------------------------------------
-- 1. article_packagings: lista de embalagens disponíveis
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION article_packagings(p_article_id UUID)
RETURNS TABLE(
  label         TEXT,
  base_per_unit NUMERIC,
  source        TEXT,
  sort_key      INT
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  WITH base AS (
    -- RLS em articles aplica: se o artigo não pertence à org, devolve 0 linhas.
    SELECT a.unit
    FROM articles a
    WHERE a.id = p_article_id
  ),
  -- Fonte 1: tamanhos definidos pelo restaurante (art. > prioridade)
  sizes AS (
    SELECT
      s.label::TEXT                      AS label,
      s.base_per_unit::NUMERIC           AS base_per_unit,
      'size'::TEXT                       AS source,
      (100 + COALESCE(s.sort_order, 0))::INT AS sort_key
    FROM article_sizes s
    WHERE s.article_id = p_article_id
  ),
  -- Fonte 2: order_units de fornecedores (preferred primeiro)
  suppliers AS (
    SELECT
      ars.order_unit::TEXT                                 AS label,
      ars.conversion_factor::NUMERIC                       AS base_per_unit,
      'supplier'::TEXT                                     AS source,
      (CASE WHEN ars.is_preferred THEN 200 ELSE 250 END)::INT AS sort_key
    FROM article_suppliers ars
    WHERE ars.article_id = p_article_id
      AND ars.order_unit IS NOT NULL
      AND ars.conversion_factor > 0
  ),
  -- Fonte 3: fallback "solto" derivado de articles.unit
  --   g  → kg solto (1000)
  --   mL → L solto  (1000)
  --   kg → kg solto (1)
  --   L  → L solto  (1)
  --   un → un solto (1)
  --   exótico (ex.: 'balde') → '<unit> solto' (1)
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
      'fallback'::TEXT                                AS source,
      900::INT                                        AS sort_key
    FROM base b
  ),
  unioned AS (
    SELECT * FROM sizes
    UNION ALL SELECT * FROM suppliers
    UNION ALL SELECT * FROM fallback
  ),
  -- Dedup: chave = (lower(label), base_per_unit). Mantém o sort_key
  -- mais baixo (= mais prioritário) para cada par.
  -- Não dedupa só por label porque "saco 5kg" (5000) e "saco 25kg" (25000)
  -- são embalagens distintas.
  deduped AS (
    SELECT DISTINCT ON (lower(label), base_per_unit)
      label, base_per_unit, source, sort_key
    FROM unioned
    ORDER BY lower(label), base_per_unit, sort_key
  )
  SELECT label, base_per_unit, source, sort_key
  FROM deduped
  ORDER BY sort_key, lower(label);
$$;

COMMENT ON FUNCTION article_packagings(UUID) IS
  'Lista embalagens disponíveis para um artigo (sizes ∪ suppliers ∪ fallback). Dedup por (label,base_per_unit). RLS via SECURITY INVOKER.';

-- ------------------------------------------------------------
-- 2. record_stock_count: ADJUSTMENT + count_lines atómico
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_stock_count(
  p_article_id UUID,
  p_lines      JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_unit         TEXT;
  v_current_qty  NUMERIC;
  v_total        NUMERIC := 0;
  v_delta        NUMERIC;
  v_movement_id  UUID;
  v_n_lines      INT;
  v_line         JSONB;
BEGIN
  -- 1. Validar artigo (RLS aplica — se não é da org, NOT FOUND)
  SELECT unit INTO v_unit
  FROM articles
  WHERE id = p_article_id;

  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'Article % not found or not accessible', p_article_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- 2. Validar input
  IF p_lines IS NULL
     OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) = 0
  THEN
    RAISE EXCEPTION 'p_lines must be a non-empty JSON array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 3. Calcular total em base_unit + validar cada linha
  FOR v_line IN SELECT jsonb_array_elements(p_lines)
  LOOP
    IF (v_line ? 'qty') IS NOT TRUE
       OR (v_line ? 'base_per_unit') IS NOT TRUE
       OR (v_line ? 'label') IS NOT TRUE
    THEN
      RAISE EXCEPTION 'Each line must have label, qty and base_per_unit'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF (v_line->>'qty')::NUMERIC < 0 THEN
      RAISE EXCEPTION 'qty must be >= 0'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF (v_line->>'base_per_unit')::NUMERIC <= 0 THEN
      RAISE EXCEPTION 'base_per_unit must be > 0'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_total := v_total + (v_line->>'qty')::NUMERIC
                       * (v_line->>'base_per_unit')::NUMERIC;
  END LOOP;

  -- 4. Ler current_qty da view (RLS aplica via security_invoker em current_stock)
  SELECT current_qty INTO v_current_qty
  FROM current_stock
  WHERE article_id = p_article_id;

  v_current_qty := COALESCE(v_current_qty, 0);
  v_delta       := v_total - v_current_qty;

  -- 5. No-op se delta desprezável (mesmo critério do código actual)
  IF abs(v_delta) < 0.0001 THEN
    RETURN NULL;
  END IF;

  -- 6. Conta linhas com qty > 0 (para a nota do movement)
  SELECT COUNT(*)::INT INTO v_n_lines
  FROM jsonb_array_elements(p_lines) elem
  WHERE (elem->>'qty')::NUMERIC > 0;

  -- 7. INSERT 1 stock_movement ADJUSTMENT.
  --    organization_id preenchido pelo trigger trg_set_org_stock_movements.
  INSERT INTO stock_movements (article_id, type, quantity, unit, notes, counted_at)
  VALUES (
    p_article_id,
    'ADJUSTMENT',
    v_delta,
    v_unit,
    'Contagem multi-linha (' || v_n_lines || ' ' ||
      CASE WHEN v_n_lines = 1 THEN 'embalagem' ELSE 'embalagens' END || ')',
    NOW()
  )
  RETURNING id INTO v_movement_id;

  -- 8. INSERT N stock_count_lines (apenas linhas com qty > 0).
  --    organization_id preenchido pelo trigger trg_set_org_stock_count_lines.
  INSERT INTO stock_count_lines (movement_id, size_label, qty, base_per_unit, base_qty)
  SELECT
    v_movement_id,
    elem->>'label',
    (elem->>'qty')::NUMERIC,
    (elem->>'base_per_unit')::NUMERIC,
    (elem->>'qty')::NUMERIC * (elem->>'base_per_unit')::NUMERIC
  FROM jsonb_array_elements(p_lines) elem
  WHERE (elem->>'qty')::NUMERIC > 0;

  RETURN v_movement_id;
END;
$$;

COMMENT ON FUNCTION record_stock_count(UUID, JSONB) IS
  'Grava contagem multi-linha: 1 stock_movement ADJUSTMENT (delta) + N stock_count_lines. Atómico. RLS via SECURITY INVOKER. Devolve movement_id ou NULL se delta desprezável.';
