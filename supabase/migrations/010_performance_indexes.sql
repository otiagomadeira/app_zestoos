-- ============================================================
-- ZESTO OS — Schema v10
-- Otimizações de performance
--
-- 1. Índices em falta para as views current_stock e order_suggestions
-- 2. Recria current_production_stock com DISTINCT ON (sem subqueries correlacionadas)
-- ============================================================

-- ── 1. Índices ────────────────────────────────────────────────────────────────

-- Join crítico na view current_stock: articles → stock_movements
CREATE INDEX IF NOT EXISTS idx_stock_movements_article
  ON stock_movements(article_id);

-- Útil para queries ordenadas por data (ex: fetchRecentMovements)
CREATE INDEX IF NOT EXISTS idx_stock_movements_article_date
  ON stock_movements(article_id, counted_at DESC);

-- NOT EXISTS em order_suggestions: filtro por status de encomenda
CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders(status);

-- NOT EXISTS em order_suggestions: join order_items → orders por artigo
CREATE INDEX IF NOT EXISTS idx_order_items_article
  ON order_items(article_id);

-- ── 2. Recriar view current_production_stock ──────────────────────────────────
-- Substitui subqueries correlacionadas (uma query por produção) por DISTINCT ON,
-- que aproveita o índice existente idx_prod_stock_counted_at.

DROP VIEW IF EXISTS current_production_stock;

CREATE VIEW current_production_stock AS
WITH latest_stock AS (
  SELECT DISTINCT ON (production_id)
    production_id,
    quantity,
    counted_at
  FROM production_stock
  ORDER BY production_id, counted_at DESC
)
SELECT
  p.id                           AS production_id,
  p.name,
  p.yield_qty,
  p.yield_unit                   AS unit,
  COALESCE(ls.quantity, 0)       AS current_qty,
  ls.counted_at
FROM productions p
LEFT JOIN latest_stock ls ON ls.production_id = p.id
WHERE p.is_active = TRUE;
