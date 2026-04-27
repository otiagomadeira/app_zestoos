/**
 * Bateria extra de stress test antes de commit.
 *
 * Usa o pipeline real (buildArticleDraft + getCountingModeOptions) sem
 * inventar API. Output em formato verificável (uma linha por caso) com
 * flags ⚠ para casos suspeitos automaticamente detetáveis.
 *
 * Não substitui test-parser.ts. É um snapshot exploratório sobre nomes
 * que chefs/fornecedores escrevem na realidade.
 *
 * Correr: npx tsx scripts/stress-battery.ts
 */

import { buildArticleDraft, getCountingModeOptions } from '../src/lib/articleDraft'
import type { ConfidenceLevel } from '../src/lib/articleConfidence'

type Family = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I'

type Probe = {
  family:   Family
  input:    string
  /** Palavras que NUNCA devem aparecer no nome (típico falso positivo). */
  forbidInName?:  string[]
  /** Subsequências que TÊM que estar no nome (ex: '20%', 'T55'). */
  requireInName?: string[]
  /** Famílias C/D/E: intenção esperada (kind). */
  expectIntent?:  string
  /** Famílias D/A: opções esperadas (1 ou 2). */
  expectOptions?: 1 | 2
  /** Categoria explicitamente esperada (quando determinística). */
  expectCategory?: string
  /** Comentário humano para o relatório. */
  note?: string
}

const PROBES: Probe[] = [
  // ───────────────── A) Mesmo produto, ordens diferentes ─────────────────
  { family: 'A', input: 'leite 1L pack 6uni',
    forbidInName: ['pack', 'caixa', 'cx'], expectIntent: 'PACKAGED_VOLUME', expectOptions: 2 },
  { family: 'A', input: 'leite pack 6uni 1L',
    forbidInName: ['pack', 'caixa'], expectIntent: 'PACKAGED_VOLUME', expectOptions: 2 },
  { family: 'A', input: '1L leite pack 6uni',
    forbidInName: ['pack'], expectIntent: 'PACKAGED_VOLUME', expectOptions: 2 },
  { family: 'A', input: 'pack 6uni leite 1L',
    forbidInName: ['pack'], expectIntent: 'PACKAGED_VOLUME', expectOptions: 2 },
  { family: 'A', input: 'leite 1lt pack 6 uni',
    forbidInName: ['pack', 'lt'], expectIntent: 'PACKAGED_VOLUME', expectOptions: 2 },
  { family: 'A', input: 'leite 1 lt pack 6 un',
    forbidInName: ['pack', 'lt'], expectIntent: 'PACKAGED_VOLUME', expectOptions: 2 },
  { family: 'A', input: 'leite 1x6L',
    forbidInName: ['1x6'], note: 'ambiguo: 1 pack de 6L? ou 1×6L?' },
  { family: 'A', input: 'leite 6x1L',
    forbidInName: ['6x1', 'pack'], expectIntent: 'PACKAGED_VOLUME', expectOptions: 2 },
  { family: 'A', input: 'leite cx 6x1L',
    forbidInName: ['cx', 'caixa'], expectIntent: 'PACKAGED_VOLUME', expectOptions: 2 },
  { family: 'A', input: 'leite caixa 6 x 1L',
    forbidInName: ['caixa'], expectIntent: 'PACKAGED_VOLUME', expectOptions: 2 },
  { family: 'A', input: 'leite pack 6L',
    forbidInName: ['pack'], note: 'sem perPack — multipack ambíguo, default volume?' },
  { family: 'A', input: 'leite 1L pack 6L',
    forbidInName: ['pack'], expectIntent: 'PACKAGED_VOLUME', expectOptions: 2,
    note: 'total mesma família = pack 6L, perPack 1L → 6 unidades' },

  // ───────────────── B) Nested packaging ─────────────────
  { family: 'B', input: 'Nata 20% pacote 1l caixa 6l',
    forbidInName: ['caixa', 'pacote'], requireInName: ['20%'],
    expectIntent: 'PACKAGED_VOLUME', expectOptions: 2,
    expectCategory: 'Lacticínios e Ovos' },
  { family: 'B', input: 'Nata 20% caixa 6l pacote 1l',
    forbidInName: ['caixa', 'pacote'], requireInName: ['20%'],
    note: 'ordem reversa do nested — outer primeiro' },
  { family: 'B', input: 'Nata 20% caixa 6 x 1l',
    forbidInName: ['caixa'], requireInName: ['20%'],
    expectIntent: 'PACKAGED_VOLUME', expectOptions: 2 },
  { family: 'B', input: 'Nata 35% pacote 1L caixa 12L',
    forbidInName: ['caixa', 'pacote'], requireInName: ['35%'],
    expectIntent: 'PACKAGED_VOLUME', expectOptions: 2 },
  { family: 'B', input: 'natas pacote 200ml caixa 12un',
    forbidInName: ['caixa', 'pacote'],
    note: 'mistura volume (200ml) + count (12un): ambíguo' },
  { family: 'B', input: 'creme culinário pacote 1l caixa 6l',
    forbidInName: ['caixa', 'pacote'],
    expectIntent: 'PACKAGED_VOLUME', expectOptions: 2 },
  { family: 'B', input: 'bebida vegetal pacote 1l caixa 6l',
    forbidInName: ['caixa', 'pacote'],
    expectIntent: 'PACKAGED_VOLUME', expectOptions: 2 },

  // ───────────────── C) Peso solto vs embalagem ─────────────────
  { family: 'C', input: 'frango 10kg',
    forbidInName: ['10kg'], expectIntent: 'WEIGHT_LOOSE', expectOptions: 1,
    note: 'peso solto, count em kg' },
  { family: 'C', input: 'frango caixa 10kg',
    forbidInName: ['caixa', '10kg'], expectIntent: 'PACKAGED_WEIGHT', expectOptions: 1 },
  { family: 'C', input: 'frango cx 10kg',
    forbidInName: ['cx'], expectIntent: 'PACKAGED_WEIGHT', expectOptions: 1 },
  { family: 'C', input: 'frango saco 10kg',
    forbidInName: ['saco'], expectIntent: 'PACKAGED_WEIGHT', expectOptions: 1 },
  { family: 'C', input: 'frango embalado 10kg',
    note: '"embalado" não é label canónico; pode cair em WEIGHT_LOOSE' },
  { family: 'C', input: 'farinha 25kg',
    expectIntent: 'WEIGHT_LOOSE', expectOptions: 1 },
  { family: 'C', input: 'farinha saco 25kg',
    forbidInName: ['saco'], expectIntent: 'PACKAGED_WEIGHT', expectOptions: 1 },
  { family: 'C', input: 'arroz 20kg',
    expectIntent: 'WEIGHT_LOOSE', expectOptions: 1 },
  { family: 'C', input: 'arroz saco 20kg',
    forbidInName: ['saco'], expectIntent: 'PACKAGED_WEIGHT', expectOptions: 1 },
  { family: 'C', input: 'batata 10kg',
    expectIntent: 'WEIGHT_LOOSE', expectOptions: 1 },
  { family: 'C', input: 'batata saco 10kg',
    forbidInName: ['saco'], expectIntent: 'PACKAGED_WEIGHT', expectOptions: 1 },
  { family: 'C', input: 'cebola roxa 20kg',
    expectIntent: 'WEIGHT_LOOSE', expectOptions: 1 },
  { family: 'C', input: 'cebola roxa saco 20kg',
    forbidInName: ['saco'], expectIntent: 'PACKAGED_WEIGHT', expectOptions: 1 },

  // ───────────────── D) Unidades contáveis ─────────────────
  { family: 'D', input: 'ovos caixa 180 uni',
    forbidInName: ['caixa'], expectIntent: 'COUNTABLE_PACKAGED', expectOptions: 1,
    note: 'NUNCA deve oferecer alternativa "unidade" — chef quer caixa' },
  { family: 'D', input: 'ovos cx 180un',
    forbidInName: ['cx'], expectIntent: 'COUNTABLE_PACKAGED', expectOptions: 1 },
  { family: 'D', input: 'ovos 180 uni caixa',
    forbidInName: ['caixa'],
    note: 'caixa depois do count + bare-count: ordem invulgar' },
  { family: 'D', input: 'ovos pack 12',
    forbidInName: ['pack'],
    note: '12 sem unidade explícita — multipack count?' },
  { family: 'D', input: 'ovos dúzia',
    note: 'dúzia não é label canónico; comportamento esperado?' },
  { family: 'D', input: 'limão caixa 50 uni',
    forbidInName: ['caixa'], expectIntent: 'COUNTABLE_PACKAGED', expectOptions: 1 },
  { family: 'D', input: 'alface caixa 12 uni',
    forbidInName: ['caixa'], expectIntent: 'COUNTABLE_PACKAGED', expectOptions: 1 },
  { family: 'D', input: 'burrata 125g caixa 6uni',
    forbidInName: ['caixa', '125g'],
    note: 'peso/unidade + count: multipack? ou COUNTABLE_PACKAGED?' },
  { family: 'D', input: 'iogurte 125g pack 4',
    forbidInName: ['pack', '125g'],
    note: 'multipack peso esperado: PACKAGED_WEIGHT 4×125g' },
  { family: 'D', input: 'manteiga bloco 250g caixa 40un',
    forbidInName: ['caixa', 'bloco'],
    note: 'nested label: bloco (inner) caixa (outer)' },

  // ───────────────── E) Embalagens reais de fornecedor ─────────────────
  { family: 'E', input: 'tomate lata 400g',
    forbidInName: ['lata'], expectIntent: 'PACKAGED_WEIGHT', expectOptions: 1 },
  { family: 'E', input: 'tomate lata 2.5kg',
    forbidInName: ['lata'], expectIntent: 'PACKAGED_WEIGHT', expectOptions: 1 },
  { family: 'E', input: 'tomate pelado lata 2,5kg',
    forbidInName: ['lata'], expectIntent: 'PACKAGED_WEIGHT', expectOptions: 1 },
  { family: 'E', input: 'atum lata 120g pack 3',
    forbidInName: ['lata', 'pack'],
    note: 'nested: lata (inner) pack (outer)' },
  { family: 'E', input: 'azeitona balde 5kg',
    forbidInName: ['balde'], expectIntent: 'PACKAGED_WEIGHT', expectOptions: 1 },
  { family: 'E', input: 'pickles balde 3kg',
    forbidInName: ['balde'], expectIntent: 'PACKAGED_WEIGHT', expectOptions: 1 },
  { family: 'E', input: 'maionese balde 5L',
    forbidInName: ['balde'], expectIntent: 'PACKAGED_VOLUME', expectOptions: 1 },
  { family: 'E', input: 'ketchup garrafa 1L pack 6',
    forbidInName: ['garrafa', 'pack'],
    note: 'nested: garrafa (inner) pack (outer)' },
  { family: 'E', input: 'azeite garrafa 750ml caixa 6',
    forbidInName: ['garrafa', 'caixa'],
    note: 'nested: garrafa (inner) caixa (outer)' },
  { family: 'E', input: 'vinho branco garrafa 75cl caixa 6',
    forbidInName: ['garrafa', 'caixa'],
    note: 'nested + cl: 75cl deve dar 750ml' },
  { family: 'E', input: 'água 0.5L pack 24',
    forbidInName: ['pack'],
    note: 'multipack: 24×500ml' },
  { family: 'E', input: 'água 1.5L pack 6',
    forbidInName: ['pack'],
    note: 'multipack: 6×1500ml' },

  // ───────────────── F) Abreviaturas reais ─────────────────
  { family: 'F', input: 'leite 1l cx6',
    forbidInName: ['cx', 'cx6'], note: 'cx6 colado — multipack abreviado' },
  { family: 'F', input: 'leite cx 6uni 1l',
    forbidInName: ['cx'], expectIntent: 'PACKAGED_VOLUME', expectOptions: 2 },
  { family: 'F', input: 'leite cx6x1l',
    forbidInName: ['cx', 'cx6'], note: 'cx6x1l completamente colado' },
  { family: 'F', input: 'leite 6x1lt',
    forbidInName: ['6x1lt'] },
  { family: 'F', input: 'nata pct 1l cx 6',
    forbidInName: ['pct', 'cx'], note: 'pct=pacote, cx=caixa abreviados' },
  { family: 'F', input: 'tomate lt 2.5kg',
    forbidInName: ['lt'], note: 'lt=lata abreviado (também unidade litro!)' },
  { family: 'F', input: 'farinha sc 25kg',
    forbidInName: ['sc'], note: 'sc=saco abreviado' },
  { family: 'F', input: 'ovos cx180',
    forbidInName: ['cx', 'cx180'], note: 'cx180 colado' },
  { family: 'F', input: 'ovos cx 180un',
    forbidInName: ['cx'], expectIntent: 'COUNTABLE_PACKAGED', expectOptions: 1 },
  { family: 'F', input: 'azeite gf 5l',
    forbidInName: ['gf'], note: 'gf=garrafa abreviado' },
  { family: 'F', input: 'agua pk 24x0.5l',
    forbidInName: ['pk'], note: 'pk=pack abreviado' },

  // ───────────────── G) Erros humanos ─────────────────
  { family: 'G', input: 'leitte 1l pack 6',
    note: 'leitte (typo) — DICT corrige?' },
  { family: 'G', input: 'leite1l pack6',
    note: 'sem espaços' },
  { family: 'G', input: 'leite 1 lpack 6',
    note: '1 lpack = unidade colada' },
  { family: 'G', input: 'nata20% pacote1l caixa6l',
    note: 'sem espaços, mas com %' },
  { family: 'G', input: 'ovoscaixa180uni',
    note: 'tudo colado' },
  { family: 'G', input: 'tomate lata2,5kg',
    note: 'lata2,5kg colado' },
  { family: 'G', input: 'arrozsaco20kg',
    note: 'arrozsaco colado' },
  { family: 'G', input: 'frango caixa10kg',
    note: 'caixa10kg colado' },

  // ───────────────── H) NÃO devem ser packaging ─────────────────
  { family: 'H', input: 'bola de berlim',
    requireInName: ['Bola', 'Berlim'],
    note: 'bola NÃO é label de packaging' },
  { family: 'H', input: 'queijo da ilha',
    requireInName: ['Queijo', 'Ilha'] },
  { family: 'H', input: 'lombo inteiro',
    requireInName: ['Lombo'],
    note: '"inteiro" pode ser stripped — verificar' },
  { family: 'H', input: 'frango inteiro',
    requireInName: ['Frango'],
    note: '"inteiro" pode ser stripped — verificar' },
  { family: 'H', input: 'tomate coração de boi',
    requireInName: ['Tomate', 'Coração'] },
  { family: 'H', input: 'pimenta em grão',
    requireInName: ['Pimenta'],
    note: '"grão" não é packaging' },
  { family: 'H', input: 'sal grosso',
    requireInName: ['Sal', 'Grosso'] },
  { family: 'H', input: 'flor de sal',
    requireInName: ['Flor'] },
  { family: 'H', input: 'folha de louro',
    requireInName: ['Louro'],
    note: '"folha" não é packaging' },
  { family: 'H', input: 'massa folhada',
    requireInName: ['Massa'] },
  { family: 'H', input: 'massa fresca',
    requireInName: ['Massa'] },
  { family: 'H', input: 'vinho do porto',
    requireInName: ['Vinho', 'Porto'] },
  { family: 'H', input: 'creme de leite',
    requireInName: ['Creme', 'Leite'] },
  { family: 'H', input: 'leite creme',
    requireInName: ['Leite', 'Creme'] },

  // ───────────────── I) Percentagens e nomes técnicos ─────────────────
  { family: 'I', input: 'Nata 20%',
    requireInName: ['20%'], expectCategory: 'Lacticínios e Ovos' },
  { family: 'I', input: 'Nata 35%',
    requireInName: ['35%'], expectCategory: 'Lacticínios e Ovos' },
  { family: 'I', input: 'leite meio gordo 1l',
    requireInName: ['Meio', 'Gordo'] },
  { family: 'I', input: 'leite magro 1l',
    requireInName: ['Magro'] },
  { family: 'I', input: 'farinha t55 25kg',
    requireInName: ['T55'] },
  { family: 'I', input: 'farinha t65 saco 25kg',
    requireInName: ['T65'], forbidInName: ['saco'] },
  { family: 'I', input: 'chocolate 70% 1kg',
    requireInName: ['70%'] },
  { family: 'I', input: 'chocolate branco 30% 1kg',
    requireInName: ['30%', 'Branco'] },
  { family: 'I', input: 'álcool 96% 1L',
    requireInName: ['96%'] },
]

// ── Execução ─────────────────────────────────────────────────────────────────

type Row = {
  family:     Family
  input:      string
  name:       string
  unit:       string
  intent:     string
  options:    string
  category:   string
  hint:       string
  flags:      string[]
  note:       string
  confidence: ConfidenceLevel
}

const rows: Row[] = []

for (const probe of PROBES) {
  let row: Row
  try {
    const draft   = buildArticleDraft(probe.input)
    const options = getCountingModeOptions({ intent: draft.intent })
    const flags: string[] = []

    if (probe.forbidInName) {
      const nameNorm = draft.name.toLowerCase()
      for (const f of probe.forbidInName) {
        if (nameNorm.includes(f.toLowerCase())) flags.push(`name contém "${f}"`)
      }
    }
    if (probe.requireInName) {
      const nameNorm = draft.name.toLowerCase()
      for (const r of probe.requireInName) {
        if (!nameNorm.includes(r.toLowerCase())) flags.push(`name falta "${r}"`)
      }
    }
    if (probe.expectIntent && draft.intent.kind !== probe.expectIntent) {
      flags.push(`intent ${draft.intent.kind} ≠ ${probe.expectIntent}`)
    }
    if (probe.expectOptions != null && options.length !== probe.expectOptions) {
      flags.push(`options ${options.length} ≠ ${probe.expectOptions}`)
    }
    if (probe.expectCategory && draft.category !== probe.expectCategory) {
      flags.push(`category "${draft.category}" ≠ "${probe.expectCategory}"`)
    }

    const intentDesc =
      draft.intent.kind === 'PACKAGED_WEIGHT'   ? `PACKAGED_WEIGHT(${draft.intent.orderUnit}, ${draft.intent.basePerOrder}${draft.intent.multipack ? `, mp=${draft.intent.multipack.count}×${draft.intent.multipack.perPack}${draft.intent.multipack.innerLabel ? `[${draft.intent.multipack.innerLabel}]` : ''}` : ''})` :
      draft.intent.kind === 'PACKAGED_VOLUME'   ? `PACKAGED_VOLUME(${draft.intent.orderUnit}, ${draft.intent.basePerOrder}${draft.intent.multipack ? `, mp=${draft.intent.multipack.count}×${draft.intent.multipack.perPack}${draft.intent.multipack.innerLabel ? `[${draft.intent.multipack.innerLabel}]` : ''}` : ''})` :
      draft.intent.kind === 'COUNTABLE_PACKAGED' ? `COUNTABLE_PACKAGED(${draft.intent.orderUnit}, ${draft.intent.perPack})` :
      draft.intent.kind

    const optsDesc = options.map(o => `${o.count_unit}/${o.base_per_unit}`).join(' | ')
    const hint     = draft.detected_label
      ? `${draft.detected_label}${draft.detected_qty ? ` ${draft.detected_qty}` : ''}${draft.detected_multipack ? ` (mp ${draft.detected_multipack.count}×${draft.detected_multipack.perPack})` : ''}`
      : (draft.detected_qty ? `qty ${draft.detected_qty}` : '')

    row = {
      family:     probe.family,
      input:      probe.input,
      name:       draft.name || '(vazio)',
      unit:       draft.unit,
      intent:     intentDesc,
      options:    optsDesc,
      category:   draft.category ?? '(none)',
      hint,
      flags,
      note:       probe.note ?? '',
      confidence: draft.confidence,
    }
  } catch (err) {
    row = {
      family:     probe.family,
      input:      probe.input,
      name:       '(CRASH)',
      unit:       '',
      intent:     '',
      options:    '',
      category:   '',
      hint:       '',
      flags:      [`CRASH: ${(err as Error).message}`],
      note:       probe.note ?? '',
      confidence: 'low',
    }
  }
  rows.push(row)
}

// ── Output ───────────────────────────────────────────────────────────────────

let totalFlagged = 0

for (const family of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const) {
  const fam = rows.filter(r => r.family === family)
  console.log(`\n━━━━━━━━━━━━ Família ${family} ━━━━━━━━━━━━`)
  for (const r of fam) {
    const flag = r.flags.length === 0 ? '✓' : '⚠'
    if (r.flags.length > 0) totalFlagged++
    console.log(`${flag}  "${r.input}"`)
    console.log(`   nome:     ${r.name}`)
    console.log(`   unit:     ${r.unit}`)
    console.log(`   intent:   ${r.intent}`)
    console.log(`   options:  ${r.options}`)
    console.log(`   category: ${r.category}`)
    if (r.hint) console.log(`   hint:     ${r.hint}`)
    if (r.note) console.log(`   nota:     ${r.note}`)
    if (r.flags.length > 0) {
      for (const f of r.flags) console.log(`   ⚠ ${f}`)
    }
  }
}

console.log(`\n────── Resumo ──────`)
console.log(`Total casos:       ${rows.length}`)
console.log(`Casos com ⚠:       ${totalFlagged}`)
console.log(`Casos limpos:      ${rows.length - totalFlagged}`)

// ── Histograma de confiança + gate de calibração ───────────────────────────
const confCounts: Record<ConfidenceLevel, number> = { high: 0, medium: 0, low: 0 }
for (const r of rows) confCounts[r.confidence]++
const total = rows.length || 1
const pct   = (n: number) => ((n / total) * 100).toFixed(1)

console.log(`\n────── Histograma de confiança ──────`)
console.log(`high:   ${pct(confCounts.high)}%  (${confCounts.high}/${total})`)
console.log(`medium: ${pct(confCounts.medium)}%  (${confCounts.medium}/${total})`)
console.log(`low:    ${pct(confCounts.low)}%  (${confCounts.low}/${total})`)

const highPct = (confCounts.high / total) * 100
const lowPct  = (confCounts.low  / total) * 100
const gateHigh = highPct >= 70
const gateLow  = lowPct  <= 12
const gatePass = gateHigh && gateLow
console.log(`\nGate de calibração (battery): ${gatePass ? 'PASS' : 'FAIL'}`)
console.log(`  high ≥ 70%:  ${gateHigh ? 'PASS' : 'FAIL'}  (${highPct.toFixed(1)}%)`)
console.log(`  low  ≤ 12%:  ${gateLow  ? 'PASS' : 'FAIL'}  (${lowPct.toFixed(1)}%)`)

process.exit(totalFlagged > 0 ? 0 : 0) // sempre 0 — exploratório, não regressão
