-- ============================================================
-- ZESTO OS — Schema v14
-- security_invoker em todas as views públicas
--
-- Problema (P0):
--   Views Postgres criadas sem `security_invoker = true` correm
--   com permissões do owner (no Supabase: role `postgres` com
--   BYPASSRLS). Resultado: SELECT em current_stock devolve linhas
--   de TODAS as orgs ao caller autenticado, ignorando RLS das
--   tabelas subjacentes.
--
-- Solução:
--   ALTER VIEW … SET (security_invoker = true) em todas as 4 views.
--   Passam a respeitar RLS na conta do caller (auth.uid via JWT
--   da Supabase). Sem alteração à definição das views — apenas
--   ao reloption.
--
-- Compatibilidade:
--   - Assinatura inalterada.
--   - Performance idêntica (RLS já estava nas tabelas; agora aplica).
--   - Aplicações que dependiam do bypass param a funcionar — mas
--     nenhuma deveria, todas devem ser autenticadas com JWT da org.
-- ============================================================

ALTER VIEW current_stock              SET (security_invoker = true);
ALTER VIEW order_suggestions          SET (security_invoker = true);
ALTER VIEW current_production_stock   SET (security_invoker = true);
ALTER VIEW production_cost            SET (security_invoker = true);
