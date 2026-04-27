/**
 * Validação leve do motor de parsing de artigos.
 *
 * Cobre:
 *   - 12 casos críticos (definidos por produto após 50 produtos difíceis)
 *   - 6 regressões próximas pedidas pelo chef
 *   - 3 regressões defensivas (Mel frasco, Hortelã pimenta, Camembert)
 *
 * Sem framework. Sem dependências extra. Usa tsx (já em devDependencies).
 *
 * Correr: npm run test:parser
 * Sai com código 1 se algum caso falhar.
 */

import { buildArticleDraft, formatDraftHint } from '../src/lib/articleDraft'
import { parseProductLines } from '../src/lib/parseProductLines'
import { parsePackagingQuantity, type ArticleBaseUnit } from '../src/lib/units'
import { getSuggestedUnitWeight } from '../src/lib/unitWeightSuggestions'

type Expect = {
  name?:             string
  unit?:             'g' | 'mL' | 'un'
  category?:         string | null
  orderUnit?:        string | null
  conversionFactor?: number | null
  detectedQty?:      number | null
  multipackCount?:   number | null
  multipackPerPack?: number | null
  hint?:             string | null
}

type Case = {
  tag:    'CRITICAL' | 'REGRESSION'
  input:  string
  expect: Expect
}

const CASES: Case[] = [
  // ── 12 casos críticos ──────────────────────────────────────────────
  { tag: 'CRITICAL', input: 'Ovo caixa 180 uni',
    expect: { name: 'Ovo', unit: 'un', orderUnit: 'caixa', conversionFactor: 180 } },
  { tag: 'CRITICAL', input: 'Ovos classe M caixa 180 uni',
    expect: { name: 'Ovos Classe M', unit: 'un', orderUnit: 'caixa', conversionFactor: 180 } },
  { tag: 'CRITICAL', input: 'Limão caixa 60 uni',
    expect: { name: 'Limão', unit: 'un', orderUnit: 'caixa', conversionFactor: 60 } },
  { tag: 'CRITICAL', input: 'Alface iceberg caixa 12 uni',
    expect: { name: 'Alface Iceberg', unit: 'un', orderUnit: 'caixa', conversionFactor: 12 } },
  { tag: 'CRITICAL', input: 'Manjericão vaso 1 uni',
    expect: { name: 'Manjericão', unit: 'un', orderUnit: 'vaso', conversionFactor: 1 } },
  { tag: 'CRITICAL', input: 'Leite sem lactose cx 6x1L',
    expect: { name: 'Leite Sem Lactose', unit: 'mL', orderUnit: 'caixa', conversionFactor: 6000,
              multipackCount: 6, multipackPerPack: 1000, hint: '6 x 1 L · caixa' } },
  { tag: 'CRITICAL', input: 'Atum em lata 1kg',
    expect: { name: 'Atum em Lata', unit: 'g', category: 'Mercearia', orderUnit: 'lata', conversionFactor: 1000 } },
  { tag: 'CRITICAL', input: 'Feijão em lata 2.5kg',
    expect: { name: 'Feijão em Lata', unit: 'g', category: 'Mercearia', orderUnit: 'lata', conversionFactor: 2500 } },
  { tag: 'CRITICAL', input: 'Feijão seco saco 5kg',
    expect: { name: 'Feijão Seco', unit: 'g', orderUnit: 'saco', conversionFactor: 5000 } },
  { tag: 'CRITICAL', input: 'Caldo galinha em pó balde 1kg',
    expect: { name: 'Caldo Galinha em Pó', unit: 'g', category: 'Mercearia', orderUnit: 'balde', conversionFactor: 1000 } },
  { tag: 'CRITICAL', input: 'Mel rosmaninho balde 5kg',
    expect: { name: 'Mel Rosmaninho', category: 'Mercearia', orderUnit: 'balde', conversionFactor: 5000 } },
  { tag: 'CRITICAL', input: 'Chocolate negro callets saco 2.5kg',
    expect: { name: 'Chocolate Negro Callets', category: 'Mercearia', orderUnit: 'saco', conversionFactor: 2500 } },

  // ── Regressões próximas ────────────────────────────────────────────
  { tag: 'REGRESSION', input: 'Rúcula saco 200g',
    expect: { name: 'Rúcula', unit: 'g', orderUnit: 'saco', conversionFactor: 200 } },
  { tag: 'REGRESSION', input: 'Tomate pelado lata 2.5kg',
    expect: { unit: 'g', category: 'Mercearia', orderUnit: 'lata', conversionFactor: 2500 } },
  { tag: 'REGRESSION', input: 'Choco limpo 1kg',
    expect: { name: 'Choco Limpo', unit: 'g', category: 'Peixe e Marisco' } },
  { tag: 'REGRESSION', input: 'Chocolate em pó saco 1kg',
    expect: { name: 'Chocolate em Pó', unit: 'g', category: 'Mercearia', orderUnit: 'saco', conversionFactor: 1000 } },
  { tag: 'REGRESSION', input: 'Água cx 12x1.5L',
    expect: { name: 'Água', unit: 'mL', category: 'Bebidas', orderUnit: 'caixa', conversionFactor: 18000,
              multipackCount: 12, multipackPerPack: 1500, hint: '12 x 1.5 L · caixa' } },
  { tag: 'REGRESSION', input: 'Natas cx 12x200ml',
    expect: { name: 'Natas', unit: 'mL', category: 'Lacticínios e Ovos', orderUnit: 'caixa', conversionFactor: 2400,
              multipackCount: 12, multipackPerPack: 200, hint: '12 x 200 mL · caixa' } },
  { tag: 'REGRESSION', input: 'Cerveja cx 24x33cl',
    expect: { name: 'Cerveja', unit: 'mL', category: 'Bebidas', orderUnit: 'caixa', conversionFactor: 7920,
              multipackCount: 24, multipackPerPack: 330, hint: '24 x 330 mL · caixa' } },

  // ── Conserva / enlatado: bug do supplierSeed silenciosamente perdido ───
  { tag: 'CRITICAL', input: 'Atum conserva 1kg',
    expect: { name: 'Atum Conserva', unit: 'g', category: 'Mercearia', orderUnit: 'conserva', conversionFactor: 1000 } },
  { tag: 'CRITICAL', input: 'Atum enlatado 1kg',
    expect: { name: 'Atum Enlatado', unit: 'g', category: 'Mercearia', orderUnit: 'lata', conversionFactor: 1000 } },
  { tag: 'CRITICAL', input: 'Pimentos em conserva frasco 1kg',
    expect: { name: 'Pimentos em Conserva', unit: 'g', category: 'Mercearia', orderUnit: 'frasco', conversionFactor: 1000 } },

  // ── Defensivas (não-regressão de cobertura existente) ──────────────
  { tag: 'REGRESSION', input: 'Mel frasco 1kg',
    expect: { name: 'Mel', category: 'Mercearia', orderUnit: 'frasco', conversionFactor: 1000 } },
  { tag: 'REGRESSION', input: 'Hortelã pimenta',
    expect: { category: 'Frutas e Legumes' } },
  { tag: 'REGRESSION', input: 'Camembert',
    expect: { category: 'Lacticínios e Ovos' } },

  // ── Categoria accent-insensitive: input do chef sem acentos ────────
  { tag: 'REGRESSION', input: 'feijao seco saco 5kg',
    expect: { category: 'Mercearia', orderUnit: 'saco', conversionFactor: 5000 } },
  { tag: 'REGRESSION', input: 'limao caixa 60 uni',
    expect: { unit: 'un', category: 'Frutas e Legumes', orderUnit: 'caixa', conversionFactor: 60 } },
  { tag: 'REGRESSION', input: 'brocolos 1kg',
    expect: { category: 'Frutas e Legumes' } },
  { tag: 'REGRESSION', input: 'acucar saco 1kg',
    expect: { category: 'Mercearia', orderUnit: 'saco', conversionFactor: 1000 } },

  // ── Fase A: bloco + dimensões + label-first ────────────────────────
  // Nota: DICT canoniza 'manteiga sem sal' → 'Manteiga sem Sal' (preposição
  // "sem" minúscula, escolha estilística PT existente no projeto).
  { tag: 'CRITICAL', input: 'manteiga sem sal bloco 1kg',
    expect: { name: 'Manteiga sem Sal', unit: 'g', category: 'Lacticínios e Ovos',
              orderUnit: 'bloco', conversionFactor: 1000 } },
  { tag: 'CRITICAL', input: 'sacos vacuo 20x30 caixa 100 uni',
    expect: { name: 'Sacos Vacuo 20x30', unit: 'un', category: 'Embalagens e Descartáveis',
              orderUnit: 'caixa', conversionFactor: 100 } },
  { tag: 'CRITICAL', input: 'caixa 180 uni ovos',
    expect: { name: 'Ovos', unit: 'un', category: 'Lacticínios e Ovos',
              orderUnit: 'caixa', conversionFactor: 180 } },
  { tag: 'CRITICAL', input: 'caixa 60 uni limao',
    expect: { name: 'Limão', unit: 'un', category: 'Frutas e Legumes',
              orderUnit: 'caixa', conversionFactor: 60 } },
  { tag: 'CRITICAL', input: 'caixa 6x1L leite meio gordo',
    expect: { name: 'Leite Meio Gordo', unit: 'mL', category: 'Lacticínios e Ovos',
              orderUnit: 'caixa', conversionFactor: 6000,
              multipackCount: 6, multipackPerPack: 1000, hint: '6 x 1 L · caixa' } },

  // ── Tokens compactos "<n>un" (sem espaço) ───────────────────────────
  // O parser perdia "Abacate 6un" porque "6un" não é peso, volume nem bare
  // number, e os filtros de UNIT_QTY_TOKENS/isBareNumber não apanhavam um
  // token misto. COMPACT_UNIT_QTY_RE fecha o buraco sem afetar dimensões
  // como "20x30" (têm 'x').
  { tag: 'CRITICAL', input: 'Abacate 6un',
    expect: { name: 'Abacate', unit: 'un', category: 'Frutas e Legumes' } },
  { tag: 'CRITICAL', input: 'Cebola 12un',
    expect: { name: 'Cebola', unit: 'un', category: 'Frutas e Legumes' } },
  { tag: 'CRITICAL', input: 'Ovos 6uni',
    expect: { name: 'Ovos', unit: 'un', category: 'Lacticínios e Ovos' } },
  { tag: 'CRITICAL', input: 'Pão de leite 6un',
    expect: { name: 'Pão de Leite', unit: 'un' } },
  { tag: 'CRITICAL', input: 'Maçã 6unidades',
    expect: { name: 'Maçã', unit: 'un', category: 'Frutas e Legumes' } },

  // ── Fase B: multipack-equivalente "qty unit + label + count uni" ───
  // Padrão: weight/volume + label adjacente DEPOIS + N uni no resto
  // → trata como multipack {count:N, perPack:qty}.
  { tag: 'CRITICAL', input: '1lt caixa 6 uni leite m.g.',
    expect: { unit: 'mL', category: 'Lacticínios e Ovos',
              orderUnit: 'caixa', conversionFactor: 6000,
              multipackCount: 6, multipackPerPack: 1000, hint: '6 x 1 L · caixa' } },
  { tag: 'CRITICAL', input: '1L caixa 6 uni leite sem lactose',
    expect: { name: 'Leite Sem Lactose', unit: 'mL', category: 'Lacticínios e Ovos',
              orderUnit: 'caixa', conversionFactor: 6000,
              multipackCount: 6, multipackPerPack: 1000, hint: '6 x 1 L · caixa' } },
]

let pass = 0
let fail = 0
const failures: string[] = []

for (const c of CASES) {
  const d    = buildArticleDraft(c.input)
  const errs: string[] = []

  if (c.expect.name !== undefined && d.name !== c.expect.name) {
    errs.push(`name: esperado "${c.expect.name}" obteve "${d.name}"`)
  }
  if (c.expect.unit !== undefined && d.unit !== c.expect.unit) {
    errs.push(`unit: esperado "${c.expect.unit}" obteve "${d.unit}"`)
  }
  if (c.expect.category !== undefined && d.category !== c.expect.category) {
    errs.push(`category: esperado "${c.expect.category}" obteve "${d.category}"`)
  }
  if (c.expect.orderUnit !== undefined) {
    const got = d.supplierSeed?.order_unit ?? null
    if (got !== c.expect.orderUnit) errs.push(`orderUnit: esperado "${c.expect.orderUnit}" obteve "${got}"`)
  }
  if (c.expect.conversionFactor !== undefined) {
    const got = d.supplierSeed?.conversion_factor ?? null
    if (got !== c.expect.conversionFactor) errs.push(`conversionFactor: esperado ${c.expect.conversionFactor} obteve ${got}`)
  }
  if (c.expect.detectedQty !== undefined) {
    const got = d.detected_qty ?? null
    if (got !== c.expect.detectedQty) errs.push(`detected_qty: esperado ${c.expect.detectedQty} obteve ${got}`)
  }
  if (c.expect.multipackCount !== undefined) {
    const got = d.detected_multipack?.count ?? null
    if (got !== c.expect.multipackCount) errs.push(`multipackCount: esperado ${c.expect.multipackCount} obteve ${got}`)
  }
  if (c.expect.multipackPerPack !== undefined) {
    const got = d.detected_multipack?.perPack ?? null
    if (got !== c.expect.multipackPerPack) errs.push(`multipackPerPack: esperado ${c.expect.multipackPerPack} obteve ${got}`)
  }
  if (c.expect.hint !== undefined) {
    const got = formatDraftHint(d)
    if (got !== c.expect.hint) errs.push(`hint: esperado "${c.expect.hint}" obteve "${got}"`)
  }

  if (errs.length === 0) {
    pass++
    console.log(`  ✓  [${c.tag}] ${c.input}`)
  } else {
    fail++
    console.log(`  ✗  [${c.tag}] ${c.input}`)
    for (const e of errs) console.log(`        ${e}`)
    failures.push(c.input)
  }
}

// ── parseProductLines: propagação de detected_multipack à ParsedLine ──────────
//
// O hint visual no Bulk Import (`SeedHint`) lê line.detected_multipack do
// ParsedLine, não do ArticleDraft. Sem esta propagação, "leite cx 6x1L" cai
// para o formato simplificado "caixa · 6 L" em vez de "caixa · 6 x 1 L".

console.log('\n── parseProductLines (multipack propagation) ──')
const PL_CASES: Array<{ input: string; count: number; perPack: number }> = [
  { input: 'leite sem lactose cx 6x1L', count: 6,  perPack: 1000 },
  { input: 'natas cx 12x200ml',          count: 12, perPack: 200  },
  { input: 'cerveja cx 24x33cl',         count: 24, perPack: 330  },
]

for (const c of PL_CASES) {
  const lines = parseProductLines(c.input, [])
  const errs: string[] = []
  if (lines.length !== 1) {
    errs.push(`esperado 1 linha, obteve ${lines.length}`)
  } else {
    const mp = lines[0].detected_multipack
    if (!mp) errs.push('detected_multipack ausente em ParsedLine')
    else {
      if (mp.count   !== c.count)   errs.push(`count: esperado ${c.count} obteve ${mp.count}`)
      if (mp.perPack !== c.perPack) errs.push(`perPack: esperado ${c.perPack} obteve ${mp.perPack}`)
    }
  }
  if (errs.length === 0) {
    pass++
    console.log(`  ✓  [PARSED-LINE] ${c.input}`)
  } else {
    fail++
    console.log(`  ✗  [PARSED-LINE] ${c.input}`)
    for (const e of errs) console.log(`        ${e}`)
    failures.push(c.input)
  }
}

// ── parsePackagingQuantity (linguagem de cozinha → base_unit) ────────────────
//
// Cobre o spec do campo "Cada embalagem traz" do bloco de fornecedor:
//   chef escreve "10kg" → guarda 10000 (em base_unit g)
//   chef escreve "5L"   → guarda 5000  (em base_unit mL)
//   chef escreve "180"  → guarda 180   (em base_unit un)
//
// Casos OK + casos INCOMPATIBLE_UNIT (família errada) + INVALID (lixo).

console.log('\n── parsePackagingQuantity ──')

type PkgCase = {
  input: string
  unit:  ArticleBaseUnit
  expected:
    | { ok: true;  value: number }
    | { ok: false; reason: 'INCOMPATIBLE_UNIT' | 'INVALID' }
}

const PKG_CASES: PkgCase[] = [
  // ── unit=g: peso em todas as formas ──────────────────────────────────
  { input: '10kg',       unit: 'g', expected: { ok: true, value: 10000 } },
  { input: '10 kg',      unit: 'g', expected: { ok: true, value: 10000 } },
  { input: '10000g',     unit: 'g', expected: { ok: true, value: 10000 } },
  { input: '10000gr',    unit: 'g', expected: { ok: true, value: 10000 } },
  { input: '10000 g',    unit: 'g', expected: { ok: true, value: 10000 } },
  { input: '2,5kg',      unit: 'g', expected: { ok: true, value: 2500 } },
  { input: '2.5kg',      unit: 'g', expected: { ok: true, value: 2500 } },
  { input: '3k',         unit: 'g', expected: { ok: true, value: 3000 } },
  { input: '3kg',        unit: 'g', expected: { ok: true, value: 3000 } },
  { input: '500g',       unit: 'g', expected: { ok: true, value: 500 } },
  { input: '500',        unit: 'g', expected: { ok: true, value: 500 } },
  { input: '500 gramas', unit: 'g', expected: { ok: true, value: 500 } },

  // ── unit=mL: volume em todas as formas ───────────────────────────────
  { input: '5L',     unit: 'mL', expected: { ok: true, value: 5000 } },
  { input: '5 l',    unit: 'mL', expected: { ok: true, value: 5000 } },
  { input: '5000ml', unit: 'mL', expected: { ok: true, value: 5000 } },
  { input: '2,5L',   unit: 'mL', expected: { ok: true, value: 2500 } },
  { input: '2.5L',   unit: 'mL', expected: { ok: true, value: 2500 } },
  { input: '750ml',  unit: 'mL', expected: { ok: true, value: 750 } },
  { input: '33cl',   unit: 'mL', expected: { ok: true, value: 330 } },
  { input: '5dl',    unit: 'mL', expected: { ok: true, value: 500 } },
  { input: '750',    unit: 'mL', expected: { ok: true, value: 750 } },

  // ── unit=un: contagem ────────────────────────────────────────────────
  { input: '6un',         unit: 'un', expected: { ok: true, value: 6 } },
  { input: '6 un',        unit: 'un', expected: { ok: true, value: 6 } },
  { input: '12uni',       unit: 'un', expected: { ok: true, value: 12 } },
  { input: '180 unidades',unit: 'un', expected: { ok: true, value: 180 } },
  { input: '180',         unit: 'un', expected: { ok: true, value: 180 } },

  // ── INCOMPATIBLE_UNIT: família errada ────────────────────────────────
  { input: '5L',   unit: 'g',  expected: { ok: false, reason: 'INCOMPATIBLE_UNIT' } },
  { input: '10kg', unit: 'mL', expected: { ok: false, reason: 'INCOMPATIBLE_UNIT' } },
  { input: '10kg', unit: 'un', expected: { ok: false, reason: 'INCOMPATIBLE_UNIT' } },
  { input: '5L',   unit: 'un', expected: { ok: false, reason: 'INCOMPATIBLE_UNIT' } },
  { input: '6un',  unit: 'g',  expected: { ok: false, reason: 'INCOMPATIBLE_UNIT' } },
  { input: '6un',  unit: 'mL', expected: { ok: false, reason: 'INCOMPATIBLE_UNIT' } },

  // ── INVALID: lixo, vazio, zero, formato impossível ───────────────────
  { input: '',        unit: 'g',  expected: { ok: false, reason: 'INVALID' } },
  { input: '',        unit: 'mL', expected: { ok: false, reason: 'INVALID' } },
  { input: '',        unit: 'un', expected: { ok: false, reason: 'INVALID' } },
  { input: 'abc',     unit: 'g',  expected: { ok: false, reason: 'INVALID' } },
  { input: '0kg',     unit: 'g',  expected: { ok: false, reason: 'INVALID' } },
  { input: '-10kg',   unit: 'g',  expected: { ok: false, reason: 'INVALID' } },
  { input: '10kg2',   unit: 'g',  expected: { ok: false, reason: 'INVALID' } },
  { input: '5.5.5kg', unit: 'g',  expected: { ok: false, reason: 'INVALID' } },
  { input: '10xyz',   unit: 'g',  expected: { ok: false, reason: 'INVALID' } },
]

for (const c of PKG_CASES) {
  const result = parsePackagingQuantity(c.input, c.unit)
  const okMatch =
    result.ok === c.expected.ok &&
    (result.ok && c.expected.ok
      ? result.value === c.expected.value
      : !result.ok && !c.expected.ok
        ? result.reason === c.expected.reason
        : false)
  if (okMatch) {
    pass++
    const expr = c.expected.ok
      ? String(c.expected.value)
      : c.expected.reason
    console.log(`  ✓  [PKG] ${JSON.stringify(c.input)} (${c.unit}) → ${expr}`)
  } else {
    fail++
    const got = result.ok ? String(result.value) : result.reason
    const want = c.expected.ok ? String(c.expected.value) : c.expected.reason
    console.log(`  ✗  [PKG] ${JSON.stringify(c.input)} (${c.unit})`)
    console.log(`        esperado ${want}, obteve ${got}`)
    failures.push(`PKG ${c.input} (${c.unit})`)
  }
}

// ── getSuggestedUnitWeight (peso médio por unidade) ──────────────────────────
//
// Cobre matching seguro: exact match contra chave normalizada (lowercase +
// accent-strip), token fallback apenas para whitelist explícita. Casos
// críticos: "Lima" não bate em "Limão", "Batata Doce" → null (token 'batata'
// fora da whitelist), "Ovo de Codorniz" → null (token 'ovo' fora).

console.log('\n── getSuggestedUnitWeight ──')

const SUG_CASES: Array<{ name: string; expected: number | null }> = [
  // Exact match — base
  { name: 'Maçã',             expected: 180 },
  { name: 'Lima',             expected: 70  },
  { name: 'Limão',            expected: 100 },
  { name: 'Cebola Roxa',      expected: 180 },
  { name: 'Batata',           expected: 200 },
  { name: 'Tomate',           expected: 150 },
  { name: 'Ovo',              expected: 52  },
  { name: 'Alface Iceberg',   expected: 500 },
  { name: 'Alface Romana',    expected: 350 },
  // Token fallback (whitelist)
  { name: 'Limão Siciliano',  expected: 100 },
  { name: 'Cebola Doce',      expected: 180 },
  // Token fallback bloqueado (não whitelist)
  { name: 'Tomate Cherry',    expected: null },
  { name: 'Ovo de Codorniz',  expected: null },
  { name: 'Alface',           expected: null },
  // Sem qualquer match
  { name: '',                 expected: null },

  // ── Base expandida ────────────────────────────────────────────────────
  // Maçã (variedades)
  { name: 'Maçã Royal Gala',  expected: 170 },
  { name: 'Maçã Reineta',     expected: 220 },
  // Pêra (com e sem acento; rocha + base)
  { name: 'Pêra',             expected: 160 },
  { name: 'Pêra Rocha',       expected: 140 },
  { name: 'Pera Rocha',       expected: 140 },
  { name: 'Pera',             expected: 160 },  // antes era null; agora exact
  // Cogumelos (exact + null seguro)
  { name: 'Cogumelo Portobello', expected: 80 },
  { name: 'Cogumelo Laminado',   expected: null },
  // Batata (variedades + doce passa a 300; palha → null)
  { name: 'Batata Agria',     expected: 220 },
  { name: 'Batata Doce',      expected: 300 },  // antes era null; agora exact
  { name: 'Batata Palha',     expected: null },
  // Pimentos (variedades, padrón com singular e plural)
  { name: 'Pimento Vermelho', expected: 180 },
  { name: 'Pimento Padrón',   expected: 12 },
  { name: 'Pimentos Padrón',  expected: 12 },   // de-pluralize → "pimento padron"
  { name: 'Malagueta',        expected: 8  },
]

for (const c of SUG_CASES) {
  const got = getSuggestedUnitWeight(c.name)
  if (got === c.expected) {
    pass++
    console.log(`  ✓  [SUG] ${JSON.stringify(c.name)} → ${got}`)
  } else {
    fail++
    console.log(`  ✗  [SUG] ${JSON.stringify(c.name)}`)
    console.log(`        esperado ${c.expected}, obteve ${got}`)
    failures.push(`SUG ${c.name}`)
  }
}

console.log(`\n${pass}/${pass + fail} passaram`)
if (fail > 0) {
  console.log('\nFalharam:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
