-- ============================================================
-- ZESTO OS — The Silent Engine
-- Schema v1 — Etapa 1 (MVP)
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- SUPPLIERS
-- ============================================================
CREATE TABLE suppliers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ARTICLES (ingredients / products)
-- ============================================================
CREATE TABLE articles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  unit            TEXT NOT NULL,          -- base unit: kg, L, un, etc.
  par_level       NUMERIC(10,3) NOT NULL DEFAULT 0,  -- minimum desired stock
  category        TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ARTICLE_SUPPLIERS (many-to-many with pricing)
-- ============================================================
CREATE TABLE article_suppliers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  article_id          UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  supplier_id         UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_ref        TEXT,                          -- supplier's product code
  price               NUMERIC(10,4) NOT NULL,        -- price per order_unit
  order_unit          TEXT NOT NULL,                 -- unit used for ordering (cx, kg, L…)
  conversion_factor   NUMERIC(10,4) NOT NULL DEFAULT 1, -- order_unit → article.unit
  is_preferred        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(article_id, supplier_id)
);

-- ============================================================
-- ORDERS
-- States: DRAFT → SENT → RECEIVED | CANCELLED
-- ============================================================
CREATE TYPE order_status AS ENUM ('DRAFT', 'SENT', 'RECEIVED', 'CANCELLED');

CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id     UUID NOT NULL REFERENCES suppliers(id),
  status          order_status NOT NULL DEFAULT 'DRAFT',
  notes           TEXT,
  sent_at         TIMESTAMPTZ,
  received_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ORDER_ITEMS
-- Snapshot: price & conversion_factor are frozen at SENT time
-- ============================================================
CREATE TABLE order_items (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  article_id            UUID NOT NULL REFERENCES articles(id),
  quantity_ordered      NUMERIC(10,3) NOT NULL,
  order_unit            TEXT NOT NULL,               -- snapshot of unit at order time
  -- SNAPSHOT fields (frozen when order → SENT)
  price_snapshot        NUMERIC(10,4),               -- price per order_unit at send time
  conversion_snapshot   NUMERIC(10,4),               -- conversion factor at send time
  -- Reception
  quantity_received     NUMERIC(10,3),
  received_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- STOCK_MOVEMENTS
-- Stock = SUM(quantity) — NEVER a direct editable field
-- ============================================================
CREATE TYPE movement_type AS ENUM ('PURCHASE', 'ADJUSTMENT', 'WASTE', 'CONSUMPTION');

CREATE TABLE stock_movements (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  article_id      UUID NOT NULL REFERENCES articles(id),
  type            movement_type NOT NULL,
  quantity        NUMERIC(10,3) NOT NULL,  -- positive = IN, negative = OUT
  unit            TEXT NOT NULL,           -- always article.unit (base unit)
  notes           TEXT,
  order_item_id   UUID REFERENCES order_items(id),  -- link if type = PURCHASE
  counted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- VIEWS
-- ============================================================

-- Current stock per article
CREATE VIEW current_stock AS
SELECT
  a.id            AS article_id,
  a.name,
  a.unit,
  a.par_level,
  a.category,
  COALESCE(SUM(sm.quantity), 0) AS current_qty,
  COALESCE(SUM(sm.quantity), 0) - a.par_level AS diff_from_par
FROM articles a
LEFT JOIN stock_movements sm ON sm.article_id = a.id
WHERE a.is_active = TRUE
GROUP BY a.id, a.name, a.unit, a.par_level, a.category;

-- Order suggestion: articles below par level with preferred supplier info
CREATE VIEW order_suggestions AS
SELECT
  cs.article_id,
  cs.name,
  cs.unit,
  cs.par_level,
  cs.current_qty,
  cs.diff_from_par,
  -- how much to order (bring to par)
  GREATEST(cs.par_level - cs.current_qty, 0) AS qty_to_order,
  ars.supplier_id,
  s.name AS supplier_name,
  ars.order_unit,
  ars.price,
  ars.conversion_factor,
  -- qty_to_order converted to order_unit
  CASE
    WHEN ars.conversion_factor > 0
    THEN CEIL(GREATEST(cs.par_level - cs.current_qty, 0) / ars.conversion_factor)
    ELSE 0
  END AS order_qty_in_order_unit
FROM current_stock cs
LEFT JOIN article_suppliers ars ON ars.article_id = cs.article_id AND ars.is_preferred = TRUE
LEFT JOIN suppliers s ON s.id = ars.supplier_id
WHERE cs.current_qty < cs.par_level;

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_articles_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_article_suppliers_updated_at
  BEFORE UPDATE ON article_suppliers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_order_items_updated_at
  BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Snapshot trigger: when order → SENT, freeze price & conversion on all items
CREATE OR REPLACE FUNCTION snapshot_order_items()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'SENT' AND OLD.status != 'SENT' THEN
    UPDATE order_items oi
    SET
      price_snapshot      = ars.price,
      conversion_snapshot = ars.conversion_factor
    FROM article_suppliers ars
    WHERE oi.order_id = NEW.id
      AND ars.article_id = oi.article_id
      AND ars.supplier_id = NEW.supplier_id
      AND oi.price_snapshot IS NULL;

    NEW.sent_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_snapshot_on_sent
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION snapshot_order_items();

-- ============================================================
-- SEED DATA — "Caso do Mel" (Simulação Técnica V7)
-- ============================================================

INSERT INTO suppliers (id, name, email, phone) VALUES
  ('a1b2c3d4-0001-0001-0001-000000000001', 'Apicola Nacional', 'encomendas@apicola.pt', '+351 210 000 001'),
  ('a1b2c3d4-0001-0001-0001-000000000002', 'Distribuidora Premium', 'stock@distprem.pt', '+351 210 000 002');

INSERT INTO articles (id, name, unit, par_level, category) VALUES
  ('b2c3d4e5-0002-0002-0002-000000000001', 'Mel Silvestre', 'kg',  5.0, 'Mercearia'),
  ('b2c3d4e5-0002-0002-0002-000000000002', 'Farinha T65',   'kg', 20.0, 'Padaria'),
  ('b2c3d4e5-0002-0002-0002-000000000003', 'Azeite Extra Virgem', 'L', 10.0, 'Mercearia'),
  ('b2c3d4e5-0002-0002-0002-000000000004', 'Ovos Classe M',  'un', 60.0, 'Frescos'),
  ('b2c3d4e5-0002-0002-0002-000000000005', 'Manteiga s/ sal', 'kg', 3.0, 'Frescos');

INSERT INTO article_suppliers (article_id, supplier_id, supplier_ref, price, order_unit, conversion_factor, is_preferred) VALUES
  ('b2c3d4e5-0002-0002-0002-000000000001', 'a1b2c3d4-0001-0001-0001-000000000001', 'MEL-SIL-5KG', 18.50, 'cx5kg', 5.0, TRUE),
  ('b2c3d4e5-0002-0002-0002-000000000002', 'a1b2c3d4-0001-0001-0001-000000000002', 'FAR-T65-25',  8.90,  'saco25kg', 25.0, TRUE),
  ('b2c3d4e5-0002-0002-0002-000000000003', 'a1b2c3d4-0001-0001-0001-000000000002', 'AZ-EV-5L',   12.40, 'garrafao5L', 5.0, TRUE),
  ('b2c3d4e5-0002-0002-0002-000000000004', 'a1b2c3d4-0001-0001-0001-000000000002', 'OVO-M-30',    4.20, 'cx30un', 30.0, TRUE),
  ('b2c3d4e5-0002-0002-0002-000000000005', 'a1b2c3d4-0001-0001-0001-000000000002', 'MNT-SS-1KG',  6.80, 'kg', 1.0, TRUE);

-- Initial stock movements (ADJUSTMENT = opening stock)
INSERT INTO stock_movements (article_id, type, quantity, unit, notes) VALUES
  ('b2c3d4e5-0002-0002-0002-000000000001', 'ADJUSTMENT',  2.5, 'kg', 'Contagem inicial'),
  ('b2c3d4e5-0002-0002-0002-000000000002', 'ADJUSTMENT', 18.0, 'kg', 'Contagem inicial'),
  ('b2c3d4e5-0002-0002-0002-000000000003', 'ADJUSTMENT',  6.0, 'L',  'Contagem inicial'),
  ('b2c3d4e5-0002-0002-0002-000000000004', 'ADJUSTMENT', 72.0, 'un', 'Contagem inicial'),
  ('b2c3d4e5-0002-0002-0002-000000000005', 'ADJUSTMENT',  1.2, 'kg', 'Contagem inicial');
