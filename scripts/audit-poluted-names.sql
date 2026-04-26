-- ============================================================
-- ZESTO OS — Auditoria de nomes poluídos com unidades compactas
-- ============================================================
--
-- Contexto: o parser tinha um buraco em tokens "<n>un|uni|unidade(s)"
-- compactos (ex.: "Abacate 6un"). Foi corrigido em e3f8ee0, mas dados
-- antigos podem ter sido persistidos com o nome poluído.
--
-- Estas queries SÃO SÓ DE LEITURA. Não fazem UPDATE.
-- Correr no SQL Editor do Supabase (autenticado como user da org).
--
-- O regex `\d+\s*(un|uni|...)(\s|$)` apanha:
--   - "Abacate 6un"  (compacto, sem espaço)
--   - "Cebola 12 un" (com espaço)
--   - "Ovos 6 unidades"
-- e NÃO apanha:
--   - "Sacos vacuo 20x30"  (sem unidade)
--   - "Atum em lata"        (sem dígitos colados a "un")

-- ── 1. Artigos com nome poluído ──────────────────────────────
SELECT
  id,
  name,
  unit,
  category,
  is_active,
  created_at
FROM articles
WHERE name ~* '\d+\s*(un|uni|unis|unid|unids|unidade|unidades)(\s|$)'
ORDER BY created_at DESC;


-- ── 2. Aliases possivelmente contaminados ────────────────────
-- Schema real: ingredient_aliases (key, canonical_name, organization_id, created_at)
-- PK composta (key, organization_id) — não há coluna `id` nem `alias`.
SELECT
  key,
  canonical_name,
  organization_id,
  created_at
FROM ingredient_aliases
WHERE key ~* '\d+\s*(un|uni|unis|unid|unids|unidade|unidades)(\s|$)'
   OR canonical_name ~* '\d+\s*(un|uni|unis|unid|unids|unidade|unidades)(\s|$)'
ORDER BY created_at DESC;


-- ── 3. Resumo (contagens) ────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM articles
     WHERE name ~* '\d+\s*(un|uni|unis|unid|unids|unidade|unidades)(\s|$)')
    AS articles_afetados,
  (SELECT COUNT(*) FROM ingredient_aliases
     WHERE key ~* '\d+\s*(un|uni|unis|unid|unids|unidade|unidades)(\s|$)'
        OR canonical_name ~* '\d+\s*(un|uni|unis|unid|unids|unidade|unidades)(\s|$)')
    AS aliases_afetados;
