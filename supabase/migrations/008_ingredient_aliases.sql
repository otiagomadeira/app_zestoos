-- ============================================================
-- ZESTO OS — Schema v8
-- Ingredient aliases per organization (auto-learning)
-- ============================================================

CREATE TABLE ingredient_aliases (
  key             TEXT        NOT NULL,
  canonical_name  TEXT        NOT NULL,
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, organization_id)
);

ALTER TABLE ingredient_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read aliases"
  ON ingredient_aliases FOR SELECT
  USING (organization_id = current_org_id());

CREATE POLICY "org members can insert aliases"
  ON ingredient_aliases FOR INSERT
  WITH CHECK (organization_id = current_org_id());

CREATE POLICY "org members can update aliases"
  ON ingredient_aliases FOR UPDATE
  USING      (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

CREATE POLICY "org members can delete aliases"
  ON ingredient_aliases FOR DELETE
  USING (organization_id = current_org_id());
