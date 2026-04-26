-- ============================================================
-- ZESTO OS — Schema v19
-- Drop fallback sempre que existir size ou supplier
-- ============================================================
--
-- Decisão de produto:
--   "Se um artigo já tem embalagem definida, conta-se nessa embalagem.
--    Não há contagem paralela 'a granel'."
--
--   A regra de 018 (dropar fallback apenas quando base_per_unit colide
--   com um size/supplier) deixava entrar duplas como [saco 25 kg, kg solto]
--   no UI multi — bases diferentes (25 vs 1) não colidiam, logo sobrevivam
--   ambas. O chef NUNCA quer essa dupla: se a farinha vem em sacos, conta-se
--   sacos.
--
-- Regra desta migration:
--   "Manter sempre as linhas de article_sizes e article_suppliers.
--    Manter o fallback APENAS quando não existir nenhuma linha
--    de size ou supplier para o artigo."
--
--   Aplicada às mesmas duas funções de 018:
--     1. article_packagings(uuid)
--     2. _article_packaging_summary(uuid)
--
-- Compatibilidade:
--   - CREATE OR REPLACE FUNCTION; assinaturas inalteradas
--     → views current_stock e order_suggestions continuam válidas.
--   - record_stock_count_inline (017) consome _article_packaging_summary
--     pelo mesmo contrato.
--   - Movimentos existentes em stock_movements não são afectados
--     (qty é em base_unit; source/label não interfere).
--   - Sessões em curso continuam idempotentes via count_session_id.
--
-- Impacto esperado (no projecto Zesto OS, 26/04):
--   - ~47 artigos com [size/supplier + fallback] passam a inline simples
--     (count=2 → count=1). Ex.: Farinha T65, Alho, Manteiga sem Sal,
--     Cebola, Espargos, Mel Rosmaninho, Salmão Fumado, …
--   - Rúcula passa de count=3 → count=2 (mantém 200 g e 500 g; perde kg solto).
--   - 79 artigos sem alteração (não tinham size/supplier; mantêm fallback).
-- ============================================================

-- ------------------------------------------------------------
-- 1. article_packagings: nova regra de filtragem do fallback
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
  -- Nova regra: fallback só sobrevive quando NÃO há nenhuma linha
  -- de size ou supplier para o artigo. Substitui a filtragem por
  -- base_per_unit da 018.
  filtered AS (
    SELECT u.label, u.base_per_unit, u.source, u.sort_key
    FROM unioned u
    WHERE u.source <> 'fallback'
       OR NOT EXISTS (
         SELECT 1 FROM unioned u2
         WHERE u2.source <> 'fallback'
       )
  ),
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
  'Lista embalagens (sizes ∪ suppliers ∪ fallback). Fallback descartado quando existir QUALQUER size ou supplier. Dedup por (lower(label), base_per_unit). RLS via SECURITY INVOKER.';

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
  'Sumário de embalagens (count + label/base quando count=1). Fallback descartado quando existir QUALQUER size ou supplier. Substitui a regra de 018.';

-- ------------------------------------------------------------
-- Notas:
--   - Sem DROP+CREATE de views; assinaturas das funções inalteradas.
--   - security_invoker=true em current_stock/order_suggestions preservado.
--   - record_stock_count_inline continua válido sem alteração.
-- ============================================================
