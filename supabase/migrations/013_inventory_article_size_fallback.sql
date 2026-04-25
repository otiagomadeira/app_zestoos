-- ============================================================
-- ZESTO OS — Schema v13
-- Inventário com fallback para article_sizes
--
-- Problema:
--   A v12 deriva stock_unit/base_per_stock apenas de article_suppliers
--   (is_preferred = TRUE). Artigos sem fornecedor preferido caem
--   para base_unit (un, g, mL) — pouco natural para contagem.
--
-- Solução (sem novos campos em articles):
--   Hierarquia de derivação em current_stock:
--     1. article_supplier preferido (camada actual)
--     2. article_sizes default do artigo (sort_order ASC, created_at ASC LIMIT 1)
--     3. base_unit (unit, 1) — fallback final
--
-- Suporte a INSERT ON CONFLICT em article_sizes:
--   UNIQUE constraint em (article_id, lower(label)) via expression index.
--   Permite app fazer "createArticleSizeIfMissing" idempotente.
--
-- Compatibilidade:
--   - Assinatura de current_stock e order_suggestions inalterada
--   - article_sizes está vazia em produção: zero impacto imediato
--   - current_qty e par_level continuam em base_unit
-- ============================================================

-- ------------------------------------------------------------
-- 1. UNIQUE constraint case-insensitive em article_sizes.label
-- ------------------------------------------------------------
-- Expression index é válido como conflict target em INSERT ... ON CONFLICT
-- desde que a expressão da cláusula ON CONFLICT seja idêntica.
-- App deve usar: ON CONFLICT (article_id, lower(label)) DO NOTHING
CREATE UNIQUE INDEX IF NOT EXISTS uniq_article_sizes_article_label_lc
  ON article_sizes (article_id, lower(label));

-- ------------------------------------------------------------
-- 2. Índice de default-pick para LATERAL ... LIMIT 1
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_article_sizes_default_pick
  ON article_sizes (article_id, sort_order ASC, created_at ASC);

-- ------------------------------------------------------------
-- 3. Recriar current_stock com fallback de 3 camadas
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
  COALESCE(SUM(sm.quantity), 0) - a.par_level                AS diff_from_par
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
WHERE a.is_active = TRUE
GROUP BY
  a.id, a.name, a.unit, a.par_level, a.category,
  ars.order_unit, ars.conversion_factor,
  sz.label, sz.base_per_unit;

-- ------------------------------------------------------------
-- 4. Recriar order_suggestions (cópia exacta da 012)
-- ------------------------------------------------------------
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
