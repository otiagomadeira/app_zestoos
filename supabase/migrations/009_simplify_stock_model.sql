-- ============================================================
-- ZESTO OS — Schema v9
-- Simplificação do modelo de stock para MVP
--
-- 0. Remove coluna stock_unit de articles (obsoleta)
-- 1. Migra conversion_factor ← base_per_order_unit onde configurado
-- 2. Simplifica current_stock: base_per_stock=1, stock_unit=unit
-- 3. Simplifica order_suggestions: remove dependência de stock_unit
-- 4. Cria RPC receive_order: receção atómica numa transação
-- ============================================================

-- ── 0. Remover coluna stock_unit (já não usada pelo código) ──────────────────
ALTER TABLE articles DROP COLUMN IF EXISTS stock_unit;

-- ── 1. Migrar conversion_factor ← base_per_order_unit ─────────────────────────
-- Após esta migração, conversion_factor = base_units por order_unit para todos
-- os artigos que tinham base_per_order_unit configurado.
UPDATE article_suppliers
SET conversion_factor = base_per_order_unit
WHERE base_per_order_unit IS NOT NULL
  AND base_per_order_unit > 0;

-- ── 2. Simplificar view current_stock ────────────────────────────────────────
-- Remove a dependência ao fornecedor preferido: base_per_stock=1, stock_unit=unit.
DROP VIEW IF EXISTS order_suggestions;
DROP VIEW IF EXISTS current_stock;

CREATE VIEW current_stock AS
SELECT
  a.id                             AS article_id,
  a.name,
  a.unit,
  a.unit                           AS stock_unit,
  a.par_level,
  a.category,
  1                                AS base_per_stock,
  COALESCE(SUM(sm.quantity), 0)    AS current_qty_base,
  COALESCE(SUM(sm.quantity), 0)    AS current_qty,
  COALESCE(SUM(sm.quantity), 0) - a.par_level AS diff_from_par
FROM articles a
LEFT JOIN stock_movements sm ON sm.article_id = a.id
WHERE a.is_active = TRUE
GROUP BY a.id, a.name, a.unit, a.par_level, a.category;

-- ── 3. Simplificar view order_suggestions ────────────────────────────────────
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

-- ── 4. RPC receive_order ──────────────────────────────────────────────────────
-- Substitui a lógica multi-query do cliente por uma transação atómica.
-- SECURITY INVOKER (default): corre com as credenciais do utilizador (RLS activo).
CREATE OR REPLACE FUNCTION receive_order(p_order_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- 1. Inserir movimentos PURCHASE em base_unit para cada item da encomenda
  INSERT INTO stock_movements(
    article_id, type, quantity, unit, notes, order_item_id, counted_at
  )
  SELECT
    oi.article_id,
    'PURCHASE',
    oi.quantity_ordered * COALESCE(
      oi.conversion_snapshot,  -- snapshot gravado ao SENT
      ars.conversion_factor,   -- valor atual do fornecedor preferido
      1                        -- fallback: sem fornecedor configurado
    ),
    a.unit,
    'Receção de encomenda',
    oi.id,
    v_now
  FROM order_items oi
  JOIN articles a ON a.id = oi.article_id
  LEFT JOIN article_suppliers ars
    ON ars.article_id = oi.article_id
    AND ars.is_preferred = TRUE
  WHERE oi.order_id = p_order_id;

  -- 2. Registar quantidade recebida em cada item
  UPDATE order_items
  SET
    quantity_received = quantity_ordered,
    received_at       = v_now
  WHERE order_id = p_order_id;

  -- 3. Marcar encomenda como recebida
  UPDATE orders
  SET
    status      = 'RECEIVED',
    received_at = v_now
  WHERE id = p_order_id;
END;
$$;
