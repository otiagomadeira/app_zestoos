-- ============================================================
-- ZESTO OS — Schema v3
-- Auth + Multi-tenancy
-- ============================================================

-- ============================================================
-- ORGANIZATIONS
-- One row per restaurant. Root of all tenant data.
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PROFILES
-- One row per auth user. Links auth.users → organizations.
-- ============================================================

CREATE TABLE IF NOT EXISTS profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  full_name       TEXT,
  role            TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'member'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TRIGGER: auto-create org + profile on auth.users INSERT
-- Reads restaurant_name from user metadata (set at signUp)
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id UUID;
  org_slug TEXT;
BEGIN
  -- Build slug: lowercase, non-alphanumeric → dash, + first 8 chars of user id
  org_slug := LOWER(
    REGEXP_REPLACE(
      COALESCE(NEW.raw_user_meta_data ->> 'restaurant_name', 'restaurante'),
      '[^a-z0-9]+', '-', 'gi'
    )
  ) || '-' || LEFT(NEW.id::text, 8);

  INSERT INTO organizations (name, slug)
  VALUES (
    COALESCE(NEW.raw_user_meta_data ->> 'restaurant_name', 'Meu Restaurante'),
    org_slug
  )
  RETURNING id INTO org_id;

  INSERT INTO profiles (id, organization_id, role)
  VALUES (NEW.id, org_id, 'owner');

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- ADD organization_id TO ALL TENANT TABLES
-- Order: seed org → add nullable → fill → make NOT NULL
-- ============================================================

-- 1. Seed organization for existing data
INSERT INTO organizations (id, name, slug)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Restaurante Demo',
  'restaurante-demo'
)
ON CONFLICT (id) DO NOTHING;

-- 2. Add columns (nullable first so existing rows don't fail)
ALTER TABLE suppliers          ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE articles           ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE article_suppliers  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE orders             ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE order_items        ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE stock_movements    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE productions        ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE production_ingredients ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE production_stock   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- 3. Fill existing rows with seed org
UPDATE suppliers          SET organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE articles           SET organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE article_suppliers  SET organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE orders             SET organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE order_items        SET organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE stock_movements    SET organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE productions        SET organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE production_ingredients SET organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' WHERE organization_id IS NULL;
UPDATE production_stock   SET organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' WHERE organization_id IS NULL;

-- 4. Make NOT NULL
ALTER TABLE suppliers          ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE articles           ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE article_suppliers  ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE orders             ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE order_items        ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE stock_movements    ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE productions        ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE production_ingredients ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE production_stock   ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- TRIGGER: auto-fill organization_id on INSERT (from profile)
-- Means no client code needs to pass organization_id explicitly
-- ============================================================

CREATE OR REPLACE FUNCTION set_organization_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_set_org_suppliers
  BEFORE INSERT ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_organization_id();

CREATE OR REPLACE TRIGGER trg_set_org_articles
  BEFORE INSERT ON articles
  FOR EACH ROW EXECUTE FUNCTION set_organization_id();

CREATE OR REPLACE TRIGGER trg_set_org_article_suppliers
  BEFORE INSERT ON article_suppliers
  FOR EACH ROW EXECUTE FUNCTION set_organization_id();

CREATE OR REPLACE TRIGGER trg_set_org_orders
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION set_organization_id();

CREATE OR REPLACE TRIGGER trg_set_org_order_items
  BEFORE INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION set_organization_id();

CREATE OR REPLACE TRIGGER trg_set_org_stock_movements
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION set_organization_id();

CREATE OR REPLACE TRIGGER trg_set_org_productions
  BEFORE INSERT ON productions
  FOR EACH ROW EXECUTE FUNCTION set_organization_id();

CREATE OR REPLACE TRIGGER trg_set_org_production_ingredients
  BEFORE INSERT ON production_ingredients
  FOR EACH ROW EXECUTE FUNCTION set_organization_id();

CREATE OR REPLACE TRIGGER trg_set_org_production_stock
  BEFORE INSERT ON production_stock
  FOR EACH ROW EXECUTE FUNCTION set_organization_id();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Helper: get current user's organization_id
-- Using a function avoids repeated subqueries and can be cached per transaction
CREATE OR REPLACE FUNCTION current_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT organization_id FROM profiles WHERE id = auth.uid()
$$;

-- organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_org" ON organizations
  USING (id = current_org_id());

-- profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_profile" ON profiles
  USING (id = auth.uid());

-- suppliers
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON suppliers
  USING      (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

-- articles
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON articles
  USING      (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

-- article_suppliers
ALTER TABLE article_suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON article_suppliers
  USING      (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

-- orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON orders
  USING      (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

-- order_items
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON order_items
  USING      (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

-- stock_movements
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON stock_movements
  USING      (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

-- productions
ALTER TABLE productions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON productions
  USING      (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

-- production_ingredients
ALTER TABLE production_ingredients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON production_ingredients
  USING      (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

-- production_stock
ALTER TABLE production_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON production_stock
  USING      (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

-- unit_conversions: global shared table, readable by authenticated users
ALTER TABLE unit_conversions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read" ON unit_conversions
  FOR SELECT USING (auth.role() = 'authenticated');
