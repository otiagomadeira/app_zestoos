-- ============================================================
-- ZESTO OS — Schema v11
-- g_per_unit: conversão de peso para artigos contáveis (un)
--
-- Problema resolvido:
--   Artigos com base_unit='un' (ex: ovos) não podiam ser
--   usados em fichas técnicas com unidade de peso (ex: 150g).
--
-- Solução:
--   articles.g_per_unit — peso médio em gramas por unidade.
--   A view production_cost passa a converter pi.unit → article.unit
--   antes de calcular o custo, via:
--     1. unit_conversions (conversões físicas: g↔kg, mL↔L, colher de sopa↔mL)
--     2. g_per_unit (artigo-específico: g→un para ovos, porções, etc.)
--     3. fallback 1.0 (unidade já é base_unit — comportamento anterior)
--
-- Retrocompatível:
--   g_per_unit = NULL → sem conversão (todos os artigos existentes)
--   production_cost: fallback garante resultado idêntico ao anterior
-- ============================================================

-- ── 1. Novo campo em articles ─────────────────────────────────
-- Peso médio em gramas de 1 unidade.
-- Só relevante para artigos com base_unit = 'un'.
-- Exemplos: ovo M → 52, porção de manteiga → 25
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS g_per_unit NUMERIC(10,4) DEFAULT NULL;

-- ── 2. Recriar view production_cost ──────────────────────────
-- Nova lógica de conversão de unidade do ingrediente → base_unit do artigo:
--
--   Prioridade:
--     A) pi.unit = a.unit                        → factor 1.0 (sem conversão)
--     B) pi.unit='g', a.unit='un', g_per_unit NN → 1.0 / g_per_unit  (g → un)
--     C) unit_conversions(pi.unit → a.unit)       → fator da tabela
--     D) fallback                                 → 1.0 (assume base_unit correto)
--
-- A case B cobre: 150g ovos com ovo.g_per_unit=52 → 150/52 = 2.88 un
-- A case C cobre: 0.5kg farinha com farinha.base_unit=g → 0.5*1000 = 500g
--                 1 colher de sopa azeite com azeite.base_unit=mL → 1*15 = 15mL

DROP VIEW IF EXISTS production_cost;

CREATE VIEW production_cost AS
SELECT
  p.id          AS production_id,
  p.name,
  p.yield_qty,
  p.yield_unit,
  COALESCE(
    SUM(
      -- quantidade convertida para base_unit, ajustada por yield_factor
      (
        pi.quantity
        * CASE
            -- A) unidade igual → sem conversão
            WHEN pi.unit = a.unit
              THEN 1.0
            -- B) g → un via g_per_unit do artigo
            WHEN pi.unit = 'g'
              AND a.unit = 'un'
              AND a.g_per_unit IS NOT NULL
              AND a.g_per_unit > 0
              THEN 1.0 / a.g_per_unit
            -- C) conversão física via unit_conversions
            WHEN uc.factor IS NOT NULL
              THEN uc.factor
            -- D) fallback: assume unidade já correcta
            ELSE 1.0
          END
        / pi.yield_factor
      )
      -- custo por base_unit = price / conversion_factor
      -- (conversion_factor = base_units por order_unit, após migration 009)
      * (ars.price / NULLIF(ars.conversion_factor, 0))
    ),
    0
  )             AS total_cost,
  CASE
    WHEN p.yield_qty > 0 THEN
      COALESCE(
        SUM(
          (
            pi.quantity
            * CASE
                WHEN pi.unit = a.unit
                  THEN 1.0
                WHEN pi.unit = 'g'
                  AND a.unit = 'un'
                  AND a.g_per_unit IS NOT NULL
                  AND a.g_per_unit > 0
                  THEN 1.0 / a.g_per_unit
                WHEN uc.factor IS NOT NULL
                  THEN uc.factor
                ELSE 1.0
              END
            / pi.yield_factor
          )
          * (ars.price / NULLIF(ars.conversion_factor, 0))
        ),
        0
      ) / p.yield_qty
    ELSE 0
  END           AS cost_per_unit
FROM productions p
LEFT JOIN production_ingredients pi
  ON pi.production_id = p.id
LEFT JOIN articles a
  ON a.id = pi.article_id
LEFT JOIN article_suppliers ars
  ON ars.article_id = pi.article_id
  AND ars.is_preferred = TRUE
-- C) join para conversões físicas entre unidades
LEFT JOIN unit_conversions uc
  ON uc.from_unit = pi.unit
  AND uc.to_unit  = a.unit
WHERE p.is_active = TRUE
GROUP BY p.id, p.name, p.yield_qty, p.yield_unit;
