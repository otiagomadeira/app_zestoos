-- ============================================================
-- ZESTO OS — Schema v4
-- Modelo de 3 Unidades: base_unit / stock_unit / order_unit
-- ============================================================
--
-- Contexto:
--   Antes: uma só `unit` por artigo usada em tudo.
--   Agora: base_unit (receitas), stock_unit (contagem), order_unit (encomenda).
--
-- Compatibilidade retroativa:
--   - stock_unit = NULL  → igual a base unit (sem mudança visual)
--   - base_per_order_unit = NULL → base_per_stock = 1 (sem mudança de cálculo)
--   - conversion_factor existente continua correto (stock=base para artigos antigos)
-- ============================================================

-- ── 1. Novo campo em articles ─────────────────────────────────
-- stock_unit: unidade de contagem no inventário (saco, molho, lata…)
-- NULL = igual à base unit (retrocompat)

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS stock_unit TEXT DEFAULT NULL;

-- ── 2. Novo campo em article_suppliers ───────────────────────
-- base_per_order_unit: quantidade em base_unit por order_unit
-- Usado para: custo por base_unit em receitas = price / base_per_order_unit
-- Também permite calcular base_per_stock = base_per_order_unit / conversion_factor
-- NULL = não configurado (recipe costing indisponível para este artigo/fornecedor)

ALTER TABLE article_suppliers
  ADD COLUMN IF NOT EXISTS base_per_order_unit NUMERIC(10,4) DEFAULT NULL;

-- ── 3. Recriar view current_stock ─────────────────────────────
-- Mudanças:
--   + stock_unit exposto
--   + base_per_stock derivado do fornecedor preferido (base_per_order_unit / conversion_factor)
--   + current_qty_base: soma dos movements em base_unit (para saveStockCount)
--   + current_qty: em stock_unit = current_qty_base / base_per_stock (para UI)
--   + diff_from_par: em stock_unit (par_level agora em stock_unit)
--
-- Retrocompat: artigos sem base_per_order_unit → base_per_stock = 1
--              → current_qty = current_qty_base (igual ao modelo anterior)

-- order_suggestions depende de current_stock — dropar primeiro
DROP VIEW IF EXISTS order_suggestions;
DROP VIEW IF EXISTS current_stock;

CREATE VIEW current_stock AS
SELECT
  a.id                                          AS article_id,
  a.name,
  a.unit,                                       -- base_unit (para receitas)
  COALESCE(a.stock_unit, a.unit)                AS stock_unit,
  a.par_level,                                  -- em stock_unit
  a.category,
  -- base_per_stock: quantas base_units há em 1 stock_unit
  -- deriva do fornecedor preferido; fallback 1 se não configurado
  COALESCE(
    pref.base_per_order_unit / NULLIF(pref.conversion_factor, 0),
    1
  )                                             AS base_per_stock,
  -- current_qty_base: soma em base_unit (usado internamente por saveStockCount)
  COALESCE(SUM(sm.quantity), 0)                 AS current_qty_base,
  -- current_qty: em stock_unit (mostrado na UI de inventário)
  COALESCE(SUM(sm.quantity), 0) / COALESCE(
    pref.base_per_order_unit / NULLIF(pref.conversion_factor, 0),
    1
  )                                             AS current_qty,
  -- diff_from_par: em stock_unit
  COALESCE(SUM(sm.quantity), 0) / COALESCE(
    pref.base_per_order_unit / NULLIF(pref.conversion_factor, 0),
    1
  ) - a.par_level                               AS diff_from_par
FROM articles a
-- LATERAL garante no máximo 1 linha por artigo (evita duplicação da soma)
LEFT JOIN LATERAL (
  SELECT base_per_order_unit, conversion_factor
  FROM article_suppliers
  WHERE article_id = a.id AND is_preferred = TRUE
  LIMIT 1
) pref ON TRUE
LEFT JOIN stock_movements sm ON sm.article_id = a.id
WHERE a.is_active = TRUE
GROUP BY
  a.id, a.name, a.unit, a.stock_unit, a.par_level, a.category,
  pref.base_per_order_unit, pref.conversion_factor;

-- ── 4. Recriar view order_suggestions ────────────────────────
-- qty_to_order em stock_unit; order_qty_in_order_unit via conversion_factor (stock→order)
-- Retrocompat: artigos antigos com stock=base → fórmula idêntica ao anterior

CREATE VIEW order_suggestions AS
SELECT
  cs.article_id,
  cs.name,
  cs.unit,
  cs.stock_unit,
  cs.par_level,
  cs.current_qty,
  cs.diff_from_par,
  -- qty_to_order: quanto falta em stock_unit
  GREATEST(cs.par_level - cs.current_qty, 0)              AS qty_to_order,
  ars.supplier_id,
  s.name                                                   AS supplier_name,
  ars.order_unit,
  ars.price,
  ars.conversion_factor,                                   -- stock_units por order_unit
  ars.base_per_order_unit,
  -- order_qty_in_order_unit: quanto encomendar em order_unit
  CASE
    WHEN ars.conversion_factor > 0
    THEN CEIL(GREATEST(cs.par_level - cs.current_qty, 0) / ars.conversion_factor)
    ELSE 0
  END                                                      AS order_qty_in_order_unit
FROM current_stock cs
LEFT JOIN article_suppliers ars
  ON ars.article_id = cs.article_id AND ars.is_preferred = TRUE
LEFT JOIN suppliers s ON s.id = ars.supplier_id
WHERE cs.current_qty < cs.par_level;

-- ── 5. Atualizar view production_cost ────────────────────────
-- Usa base_per_order_unit quando disponível (custo por base_unit correto)
-- Fallback: conversion_factor (comportamento anterior, para artigos sem base_per_order_unit)

CREATE OR REPLACE VIEW production_cost AS
SELECT
  p.id         AS production_id,
  p.name,
  p.yield_qty,
  p.yield_unit,
  COALESCE(
    SUM(
      (pi.quantity / pi.yield_factor) *
      (ars.price / COALESCE(ars.base_per_order_unit, ars.conversion_factor))
    ), 0
  )            AS total_cost,
  CASE
    WHEN p.yield_qty > 0 THEN
      COALESCE(
        SUM(
          (pi.quantity / pi.yield_factor) *
          (ars.price / COALESCE(ars.base_per_order_unit, ars.conversion_factor))
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
