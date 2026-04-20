-- ============================================================
-- ZESTO OS — Schema v5
-- stock_count_lines: composição opcional de contagens de stock
-- ============================================================
--
-- Contexto:
--   Permite registar o detalhe de uma contagem quando o chef
--   usa múltiplos tamanhos de embalagem (ex: 3 sacos 200g + 2 sacos 500g).
--   A soma de base_qty deve ser igual a stock_movements.quantity (em base_unit).
--
-- Compatibilidade:
--   - Movements sem linhas continuam a funcionar (sem mudança de comportamento)
--   - Nenhuma view existente é alterada
--   - organization_id preenchido automaticamente pelo trigger existente
-- ============================================================

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id   UUID        NOT NULL REFERENCES stock_movements(id) ON DELETE CASCADE,
  organization_id UUID      NOT NULL REFERENCES organizations(id),
  size_label    TEXT        NOT NULL,           -- ex: "saco 200g" (legível para auditoria)
  qty           NUMERIC(10,3) NOT NULL,         -- nº de unidades deste tamanho contadas
  base_per_unit NUMERIC(10,4) NOT NULL,         -- base_units por unidade (ex: 200g/saco)
  base_qty      NUMERIC(10,4) NOT NULL,         -- = qty × base_per_unit (denorm. para auditoria)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_count_lines_movement_id
  ON stock_count_lines(movement_id);

-- Auto-preencher organization_id via trigger existente
CREATE OR REPLACE TRIGGER trg_set_org_stock_count_lines
  BEFORE INSERT ON stock_count_lines
  FOR EACH ROW EXECUTE FUNCTION set_organization_id();

-- RLS: isolamento por organização
ALTER TABLE stock_count_lines ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "org_isolation" ON stock_count_lines
    USING      (organization_id = current_org_id())
    WITH CHECK (organization_id = current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
