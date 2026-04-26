-- ============================================================
-- ZESTO OS — Schema v18
-- Dedup de fallback redundante (Fase C1 — refinamento)
-- ============================================================
--
-- Problema:
--   Quando um artigo tem um supplier (ou size) cuja conversão
--   coincide com o fallback derivado de articles.unit, ambos
--   apareciam como packagings distintos:
--     Bacalhau Seco Salgado: supplier 'kg' (1) + fallback 'kg solto' (1)
--     Manteiga s/ sal:       supplier 'kg' (1) + fallback 'kg solto' (1)
--     Frango do Campo:       supplier 'kg' (1) + fallback 'kg solto' (1)
--     Ketchup:               supplier 'Balde' (1) + fallback 'balde solto' (1)
--     Azeite (unit=mL):      size '1000mL' (1000) + fallback 'L solto' (1000)
--
--   O dedup actual usa (lower(label), base_per_unit) — labels diferem,
--   logo ambas as linhas sobrevivem. Isto inflaciona packaging_count
--   e força artigos semanticamente simples a usar UI multi.
--
-- Regra desta migration:
--   "Manter sempre linhas vindas de article_sizes e article_suppliers.
--    Manter o fallback apenas quando nenhuma linha não-fallback tiver
--    o mesmo base_per_unit."
--
--   Aplicada a duas funções:
--     1. article_packagings(uuid)            (016 — usado por UI multi e RPC inline)
--     2. _article_packaging_summary(uuid)    (017 — usado pela view current_stock)
--
--   Mantemo-las consistentes para que packaging_count em current_stock
--   nunca discorde do que UI multi mostra.
--
-- Compatibilidade:
--   - Apenas CREATE OR REPLACE FUNCTION; assinaturas inalteradas
--     → views current_stock e order_suggestions continuam válidas
--     sem precisar de DROP+CREATE; security_invoker preservado.
--   - record_stock_count e record_stock_count_inline não tocados.
--   - Nenhuma alteração de tabela, índice, RLS ou policy.
--   - Movimentos existentes não são afectados.
--   - Resultado esperado: ~5 artigos passam de packaging_count=2
--     para packaging_count=1 e ficam elegíveis para UI inline.
-- ============================================================

-- ------------------------------------------------------------
-- 1. article_packagings: dedup de fallback redundante
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
    SELECT a.unit
    FROM articles a
    WHERE a.id = p_article_id
  ),
  sizes AS (
    SELECT
      s.label::TEXT                          AS label,
      s.base_per_unit::NUMERIC               AS base_per_unit,
      'size'::TEXT                           AS source,
      (100 + COALESCE(s.sort_order, 0))::INT AS sort_key
    FROM article_sizes s
    WHERE s.article_id = p_article_id
  ),
  suppliers AS (
    SELECT
      ars.order_unit::TEXT                                   AS label,
      ars.conversion_factor::NUMERIC                         AS base_per_unit,
      'supplier'::TEXT                                       AS source,
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
      'fallback'::TEXT                                AS source,
      900::INT                                        AS sort_key
    FROM base b
  ),
  unioned AS (
    SELECT * FROM sizes
    UNION ALL SELECT * FROM suppliers
    UNION ALL SELECT * FROM fallback
  ),
  -- Filtrar fallback redundante: drop-se se já existe uma linha não-fallback
  -- com o mesmo base_per_unit. Linhas de size/supplier preservadas sempre.
  filtered AS (
    SELECT u.label, u.base_per_unit, u.source, u.sort_key
    FROM unioned u
    WHERE u.source <> 'fallback'
       OR NOT EXISTS (
         SELECT 1 FROM unioned u2
         WHERE u2.source <> 'fallback'
           AND u2.base_per_unit = u.base_per_unit
       )
  ),
  -- Dedup tradicional por (label, base_per_unit) para os casos onde
  -- duas fontes não-fallback colidem (ex.: dois suppliers com mesma label
  -- e mesma base) — mantém o sort_key mais prioritário.
  deduped AS (
    SELECT DISTINCT ON (lower(label), base_per_unit)
      label, base_per_unit, source, sort_key
    FROM filtered
    ORDER BY lower(label), base_per_unit, sort_key
  )
  SELECT label, base_per_unit, source, sort_key
  FROM deduped
  ORDER BY sort_key, lower(label);
$$;

COMMENT ON FUNCTION article_packagings(UUID) IS
  'Lista embalagens disponíveis (sizes ∪ suppliers ∪ fallback). Fallback descartado quando outra fonte tem o mesmo base_per_unit. Dedup por (label,base_per_unit). RLS via SECURITY INVOKER.';

-- ------------------------------------------------------------
-- 2. _article_packaging_summary: mesma regra
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
      s.label::TEXT                          AS label,
      s.base_per_unit::NUMERIC               AS base_per_unit,
      'size'::TEXT                           AS source,
      (100 + COALESCE(s.sort_order, 0))::INT AS sort_key
    FROM article_sizes s
    WHERE s.article_id = p_article_id
  ),
  suppliers AS (
    SELECT
      ars.order_unit::TEXT                                   AS label,
      ars.conversion_factor::NUMERIC                         AS base_per_unit,
      'supplier'::TEXT                                       AS source,
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
      'fallback'::TEXT                                AS source,
      900::INT                                        AS sort_key
    FROM base b
  ),
  unioned AS (
    SELECT * FROM sizes
    UNION ALL SELECT * FROM suppliers
    UNION ALL SELECT * FROM fallback
  ),
  filtered AS (
    SELECT u.label, u.base_per_unit, u.source, u.sort_key
    FROM unioned u
    WHERE u.source <> 'fallback'
       OR NOT EXISTS (
         SELECT 1 FROM unioned u2
         WHERE u2.source <> 'fallback'
           AND u2.base_per_unit = u.base_per_unit
       )
  ),
  deduped AS (
    SELECT DISTINCT ON (lower(label), base_per_unit)
      label, base_per_unit, sort_key
    FROM filtered
    ORDER BY lower(label), base_per_unit, sort_key
  )
  SELECT
    COUNT(*)::INT,
    CASE WHEN COUNT(*) = 1 THEN MIN(label)         END,
    CASE WHEN COUNT(*) = 1 THEN MIN(base_per_unit) END
  FROM deduped;
$$;

COMMENT ON FUNCTION _article_packaging_summary(UUID) IS
  'Sumário de embalagens (count + label/base quando count=1). Aplica a mesma regra de dedup de article_packagings: fallback descartado quando outra fonte tem o mesmo base_per_unit.';

-- ------------------------------------------------------------
-- Notas:
--   - Não recriamos current_stock/order_suggestions: as funções
--     mantêm assinaturas e a view depende delas pelo nome+args.
--     CREATE OR REPLACE FUNCTION é transparente para a view.
--   - security_invoker=true em current_stock e order_suggestions
--     fica preservado (não foi tocado).
--   - record_stock_count_inline (017) usa _article_packaging_summary
--     internamente: passa a aceitar inline para os 5 artigos antes
--     bloqueados como multi.
-- ============================================================
