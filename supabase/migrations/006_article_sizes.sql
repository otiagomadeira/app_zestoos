-- ============================================================
-- ZESTO OS — Schema v6
-- article_sizes: variantes de tamanho de embalagem por artigo
-- ============================================================
--
-- Contexto:
--   Permite registar os tamanhos de embalagem disponíveis para
--   um artigo (ex: 200g, 500g, 1kg), independente de fornecedores.
--   Usado no inventário para contagem multi-tamanho.
--
-- Compatibilidade:
--   - Artigos sem article_sizes continuam a funcionar (modo simples)
--   - article_suppliers.base_per_order_unit mantém-se para custo de receitas
--   - Nenhuma view existente é alterada
-- ============================================================

CREATE TABLE IF NOT EXISTS article_sizes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id      UUID        NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  organization_id UUID        NOT NULL REFERENCES organizations(id),
  label           TEXT        NOT NULL,           -- ex: "200g", "1kg" (notação original)
  base_per_unit   NUMERIC(10,4) NOT NULL,         -- base_units por unidade (ex: 200 para 200g)
  sort_order      INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_article_sizes_article_id
  ON article_sizes(article_id);

-- Auto-preencher organization_id via trigger existente
CREATE OR REPLACE TRIGGER trg_set_org_article_sizes
  BEFORE INSERT ON article_sizes
  FOR EACH ROW EXECUTE FUNCTION set_organization_id();

-- RLS: isolamento por organização
ALTER TABLE article_sizes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON article_sizes
  USING      (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());
