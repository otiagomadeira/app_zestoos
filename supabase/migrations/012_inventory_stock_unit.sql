-- ============================================================
-- ZESTO OS — Schema v12
-- Inventário em unidade de contagem (derivada do fornecedor preferido)
--
-- Problema:
--   Cozinheiros contam stock em unidades naturais (caixa, saco, kg)
--   mas a app obrigava a contar em base_unit (un, g, mL).
--
-- Solução (sem novos campos no schema):
--   current_stock deriva stock_unit + base_per_stock do article_supplier
--   onde is_preferred = TRUE. Single source of truth: article_suppliers.
--
-- Fallback:
--   Sem fornecedor preferido → stock_unit = unit, base_per_stock = 1
--   (comportamento idêntico ao anterior; zero regressão)
--
-- Compatibilidade:
--   - current_qty continua em base_unit (mantém contrato)
--   - par_level continua em base_unit (mantém contrato)
--   - Frontend converte para stock_unit dividindo por base_per_stock
-- ============================================================

DROP VIEW IF EXISTS order_suggestions;
DROP VIEW IF EXISTS current_stock;

CREATE VIEW current_stock AS
SELECT
  a.id                                  AS article_id,
  a.name,
  a.unit,
  COALESCE(ars.order_unit, a.unit)      AS stock_unit,
  a.par_level,
  a.category,
  COALESCE(ars.conversion_factor, 1)    AS base_per_stock,
  COALESCE(SUM(sm.quantity), 0)         AS current_qty,
  COALESCE(SUM(sm.quantity), 0) - a.par_level AS diff_from_par
FROM articles a
LEFT JOIN stock_movements sm ON sm.article_id = a.id
LEFT JOIN article_suppliers ars
  ON ars.article_id = a.id
  AND ars.is_preferred = TRUE
WHERE a.is_active = TRUE
GROUP BY
  a.id, a.name, a.unit, a.par_level, a.category,
  ars.order_unit, ars.conversion_factor;

-- Recriar order_suggestions (depende de current_stock; lógica inalterada)
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
