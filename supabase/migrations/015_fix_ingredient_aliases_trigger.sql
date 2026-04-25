-- ============================================================
-- ZESTO OS — Schema v15
-- Versionar trigger de organization_id em ingredient_aliases
--
-- Problema (P1 — schema drift):
--   O trigger trg_set_org_ingredient_aliases existe em produção
--   mas não estava em nenhuma migração. Foi aplicado fora do
--   version control. Reconstruir o schema noutro ambiente apenas
--   pelas migrations deixava ingredient_aliases sem trigger →
--   inserts de learnAlias falhavam silenciosamente com NOT NULL
--   violation (cliente nunca passa organization_id), sem qualquer
--   sinal visível para o utilizador.
--
-- Solução:
--   Recriar o trigger de forma idempotente usando a função
--   set_organization_id() já definida em 003. Igual padrão usado
--   em 003 (articles, suppliers, ...), 005 (stock_count_lines) e
--   006 (article_sizes).
--
-- Compatibilidade:
--   - Idempotente: DROP IF EXISTS antes do CREATE.
--   - Em produção, recria por cima do trigger existente sem efeito
--     funcional (mesma função, mesmo timing).
-- ============================================================

DROP TRIGGER IF EXISTS trg_set_org_ingredient_aliases ON ingredient_aliases;

CREATE TRIGGER trg_set_org_ingredient_aliases
  BEFORE INSERT ON ingredient_aliases
  FOR EACH ROW EXECUTE FUNCTION set_organization_id();
