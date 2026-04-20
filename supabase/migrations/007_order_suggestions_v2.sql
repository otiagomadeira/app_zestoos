-- ============================================================
-- 007_order_suggestions_v2
-- Exclui das sugestões artigos que já têm encomenda DRAFT ou SENT pendente.
-- Evita encomendas duplicadas quando o utilizador corre as sugestões duas vezes.
-- ============================================================

CREATE OR REPLACE VIEW order_suggestions AS
SELECT
  cs.article_id,
  cs.name,
  cs.unit,
  cs.stock_unit,
  cs.par_level,
  cs.current_qty,
  cs.diff_from_par,
  -- qty_to_order: quanto falta em stock_unit
  GREATEST(cs.par_level - cs.current_qty, 0)              AS qty_to_order,
  ars.supplier_id,
  s.name                                                   AS supplier_name,
  ars.order_unit,
  ars.price,
  ars.conversion_factor,                                   -- stock_units por order_unit
  ars.base_per_order_unit,
  -- order_qty_in_order_unit: quanto encomendar em order_unit
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
  -- Excluir artigos com encomenda activa (DRAFT ou SENT)
  AND NOT EXISTS (
    SELECT 1
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.article_id = cs.article_id
      AND o.status IN ('DRAFT', 'SENT')
  );
