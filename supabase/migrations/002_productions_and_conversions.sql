-- ============================================================
-- ZESTO OS — Schema v2
-- Productions + Unit Conversions + Enum extensions
-- ============================================================

-- ── Extend movement_type enum ────────────────────────────────
-- These values will be used when a production run consumes
-- raw materials (PRODUCTION_OUT) and creates finished stock (PRODUCTION_IN)

ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'PRODUCTION_IN';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'PRODUCTION_OUT';

-- ============================================================
-- PRODUCTIONS
-- A recipe / technical sheet with a defined yield
-- ============================================================

CREATE TABLE IF NOT EXISTS productions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  yield_qty   NUMERIC(10,3) NOT NULL,    -- how much this recipe produces
  yield_unit  TEXT NOT NULL,             -- unit of the yield (kg, L, doses…)
  notes       TEXT,
  preparation TEXT,                      -- free-text preparation steps
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PRODUCTION_INGREDIENTS
-- Each row is one ingredient in a production recipe
-- ============================================================

CREATE TABLE IF NOT EXISTS production_ingredients (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  production_id     UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  article_id        UUID REFERENCES articles(id),
  sub_production_id UUID REFERENCES productions(id),
  quantity          NUMERIC(10,4) NOT NULL,
  unit              TEXT NOT NULL,
  yield_factor      NUMERIC(6,4) NOT NULL DEFAULT 1, -- efficiency: 0 < factor ≤ 1
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ingredient_ref CHECK (
    (article_id IS NOT NULL AND sub_production_id IS NULL) OR
    (article_id IS NULL     AND sub_production_id IS NOT NULL)
  )
);

-- ============================================================
-- PRODUCTION_STOCK
-- Each row = one manual count.
-- Current qty = most recent row for each production.
-- (Different from articles where stock = SUM of movements)
-- ============================================================

CREATE TABLE IF NOT EXISTS production_stock (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  production_id UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  quantity      NUMERIC(10,3) NOT NULL,
  unit          TEXT NOT NULL,
  notes         TEXT,
  counted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- UNIT_CONVERSIONS
-- Lookup table: 1 from_unit = factor × to_unit
-- ============================================================

CREATE TABLE IF NOT EXISTS unit_conversions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_unit  TEXT NOT NULL,
  to_unit    TEXT NOT NULL,
  factor     NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(from_unit, to_unit)
);

-- ============================================================
-- VIEWS
-- ============================================================

-- Latest production count per production (not cumulative)
CREATE OR REPLACE VIEW current_production_stock AS
SELECT
  p.id         AS production_id,
  p.name,
  p.yield_qty,
  p.yield_unit AS unit,
  COALESCE(
    (SELECT ps.quantity
     FROM production_stock ps
     WHERE ps.production_id = p.id
     ORDER BY ps.counted_at DESC
     LIMIT 1),
    0
  )            AS current_qty,
  (SELECT ps.counted_at
   FROM production_stock ps
   WHERE ps.production_id = p.id
   ORDER BY ps.counted_at DESC
   LIMIT 1)    AS counted_at
FROM productions p
WHERE p.is_active = TRUE;

-- Production cost based on preferred supplier prices
-- Formula per ingredient: (quantity / yield_factor) × (price / conversion_factor)
CREATE OR REPLACE VIEW production_cost AS
SELECT
  p.id         AS production_id,
  p.name,
  p.yield_qty,
  p.yield_unit,
  COALESCE(
    SUM(
      (pi.quantity / pi.yield_factor) *
      (ars.price   / ars.conversion_factor)
    ), 0
  )            AS total_cost,
  CASE
    WHEN p.yield_qty > 0 THEN
      COALESCE(
        SUM(
          (pi.quantity / pi.yield_factor) *
          (ars.price   / ars.conversion_factor)
        ), 0
      ) / p.yield_qty
    ELSE 0
  END          AS cost_per_unit
FROM productions p
LEFT JOIN production_ingredients pi
  ON pi.production_id = p.id
LEFT JOIN article_suppliers ars
  ON ars.article_id = pi.article_id
  AND ars.is_preferred = TRUE
WHERE p.is_active = TRUE
GROUP BY p.id, p.name, p.yield_qty, p.yield_unit;

-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE TRIGGER trg_productions_updated_at
  BEFORE UPDATE ON productions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_prod_ingredients_production
  ON production_ingredients(production_id);

CREATE INDEX IF NOT EXISTS idx_prod_ingredients_article
  ON production_ingredients(article_id)
  WHERE article_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prod_stock_production
  ON production_stock(production_id);

CREATE INDEX IF NOT EXISTS idx_prod_stock_counted_at
  ON production_stock(production_id, counted_at DESC);

CREATE INDEX IF NOT EXISTS idx_unit_conversions_lookup
  ON unit_conversions(from_unit, to_unit);

-- ============================================================
-- SEED: Unit Conversions
-- ============================================================

INSERT INTO unit_conversions (from_unit, to_unit, factor) VALUES
  -- Peso
  ('g',              'kg',  0.001),
  ('kg',             'g',   1000),
  ('mg',             'g',   0.001),
  ('g',              'mg',  1000),
  ('mg',             'kg',  0.000001),
  ('kg',             'mg',  1000000),
  -- Volume
  ('mL',             'L',   0.001),
  ('L',              'mL',  1000),
  ('cl',             'L',   0.01),
  ('L',              'cl',  100),
  ('dl',             'L',   0.1),
  ('L',              'dl',  10),
  ('cl',             'mL',  10),
  ('mL',             'cl',  0.1),
  ('dl',             'mL',  100),
  ('mL',             'dl',  0.01),
  -- Medidas culinárias
  ('colher de chá',  'mL',  5),
  ('mL',  'colher de chá',  0.2),
  ('colher de sopa', 'mL',  15),
  ('mL',  'colher de sopa', 0.06667),
  ('colher de chá',  'L',   0.005),
  ('colher de sopa', 'L',   0.015),
  ('L',   'colher de sopa', 66.667),
  ('L',   'colher de chá',  200)
ON CONFLICT (from_unit, to_unit) DO NOTHING;
