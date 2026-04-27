// Formata value + unit com conversão automática e máx 2 casas decimais:
// g < 1000 → "X g"  | g ≥ 1000 → "X kg"
// mL/ml < 1000 → "X ml" | mL/ml ≥ 1000 → "X L"
// outras → "X unit"
export function formatUnit(value: number, unit: string): string {
  const fmt = (n: number) => String(+(n.toFixed(2)))
  if (unit === 'g')               return value >= 1000 ? `${fmt(value / 1000)} kg` : `${fmt(value)} g`
  if (unit === 'mL' || unit === 'ml') return value >= 1000 ? `${fmt(value / 1000)} L`  : `${fmt(value)} ml`
  return `${fmt(value)} ${unit}`
}

export function formatStockQty(qty: number, unit: string): string {
  return formatUnit(qty, unit)
}

// Display de qty em base_unit "no idioma do cozinheiro": vírgula PT, sem
// embalagens (saco/lata/caixa). Usado em ArticleCard (Inventário) e no
// total agregado do CountSheet.
//   g  ≥1000 → "5,2 kg" | <1000 → "750 g"
//   mL ≥1000 → "3 L"    | <1000 → "750 mL"
//   kg/L/un  → tal como está
//   exótico (ex.: 'balde') → tal como está, sem conversão
export function formatBaseQty(qtyBase: number, baseUnit: string): string {
  const fmt = (n: number) => (+(n.toFixed(2))).toString().replace('.', ',')
  if (baseUnit === 'g')  return qtyBase >= 1000 ? `${fmt(qtyBase / 1000)} kg` : `${fmt(qtyBase)} g`
  if (baseUnit === 'mL') return qtyBase >= 1000 ? `${fmt(qtyBase / 1000)} L`  : `${fmt(qtyBase)} mL`
  return `${fmt(qtyBase)} ${baseUnit}`
}

// Formata qty (em base_unit) para display em stock_unit:
// - stock_unit === unit → formatStockQty (auto-converte g→kg, mL→L)
// - stock_unit !== unit → divide por basePerStock e mostra com stock_unit
export function formatStockDisplay(
  qtyBase:      number,
  unit:         string,
  stockUnit:    string,
  basePerStock: number,
): string {
  if (stockUnit === unit || basePerStock <= 0) {
    return formatStockQty(qtyBase, unit)
  }
  const qty = qtyBase / basePerStock
  return `${+(qty.toFixed(2))} ${stockUnit}`
}

export function formatWeight(g: number): string {
  return formatUnit(g, 'g')
}

// Unidades de embalagem para campo UN. COMPRA (fornecedores)
export const ORDER_UNITS = [
  'caixa', 'saco', 'frasco', 'lata', 'garrafa', 'pacote', 'balde', 'tabuleiro', 'bisnaga',
  'maço', 'folha', 'ramo', 'dente',
]

// ── parsePackagingQuantity ───────────────────────────────────────────────────
// Aceita input em "linguagem de cozinha" (10kg, 2,5kg, 5L, 180un, 3k) e
// devolve a quantidade em base_unit do artigo, ou um erro tipado.
//
// Usado no campo "Cada embalagem traz" do bloco de fornecedor: o chef escreve
// como fala; a Zesto converte. O número guardado em DB
// (article_suppliers.conversion_factor) continua sempre em base_unit.
//
// Casos do spec:
//   parsePackagingQuantity('10kg',   'g')  → { ok: true, value: 10000 }
//   parsePackagingQuantity('2,5kg',  'g')  → { ok: true, value: 2500 }
//   parsePackagingQuantity('3k',     'g')  → { ok: true, value: 3000 }
//   parsePackagingQuantity('5L',     'mL') → { ok: true, value: 5000 }
//   parsePackagingQuantity('180',    'un') → { ok: true, value: 180 }
//   parsePackagingQuantity('5L',     'g')  → { ok: false, reason: 'INCOMPATIBLE_UNIT' }
//   parsePackagingQuantity('10kg',   'un') → { ok: false, reason: 'INCOMPATIBLE_UNIT' }
//   parsePackagingQuantity('abc',    'g')  → { ok: false, reason: 'INVALID' }

export type ArticleBaseUnit = 'g' | 'mL' | 'un'

export type ParsePackagingResult =
  | { ok: true;  value: number }
  | { ok: false; reason: 'INCOMPATIBLE_UNIT' | 'INVALID' }

// Para cada base_unit, mapa "suffix → multiplicador para base_unit" mais
// um set de sufixos que pertencem a outra família (sinalizam INCOMPATIBLE).
// Sufixo vazio significa "número cru no base_unit do artigo".
const SUFFIX_RULES: Record<ArticleBaseUnit, {
  ok:    Record<string, number>
  wrong: ReadonlySet<string>
}> = {
  g: {
    ok: {
      '':         1,
      'g':        1,
      'gr':       1,
      'grs':      1,
      'grama':    1,
      'gramas':   1,
      'kg':       1000,
      'k':        1000,
      'mg':       0.001,
    },
    wrong: new Set([
      'l', 'lt', 'lts', 'litro', 'litros', 'ml', 'mililitro', 'mililitros', 'cl', 'dl',
      'un', 'uni', 'unis', 'unid', 'unids', 'unidade', 'unidades',
    ]),
  },
  mL: {
    ok: {
      '':            1,
      'ml':          1,
      'mililitro':   1,
      'mililitros':  1,
      'l':           1000,
      'lt':          1000,
      'lts':         1000,
      'litro':       1000,
      'litros':      1000,
      'cl':          10,
      'dl':          100,
    },
    wrong: new Set([
      'g', 'gr', 'grs', 'grama', 'gramas', 'kg', 'k', 'mg',
      'un', 'uni', 'unis', 'unid', 'unids', 'unidade', 'unidades',
    ]),
  },
  un: {
    ok: {
      '':           1,
      'un':         1,
      'uni':        1,
      'unis':       1,
      'unid':       1,
      'unids':      1,
      'unidade':    1,
      'unidades':   1,
    },
    wrong: new Set([
      'g', 'gr', 'grs', 'grama', 'gramas', 'kg', 'k', 'mg',
      'l', 'lt', 'lts', 'litro', 'litros', 'ml', 'mililitro', 'mililitros', 'cl', 'dl',
    ]),
  },
}

export function parsePackagingQuantity(
  input:       string,
  articleUnit: ArticleBaseUnit,
): ParsePackagingResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, reason: 'INVALID' }

  // Normalizar: lower-case + vírgula→ponto (PT). Não remover espaços
  // internos — a regex aceita qualquer espaço entre número e sufixo.
  const normalized = trimmed.toLowerCase().replace(',', '.')

  // Forma: <número> <espaços opcionais> <sufixo alfabético opcional>
  // Aceita "10", "10kg", "10 kg", "2.5kg", mas rejeita "5.5.5", "10kg2", "abc".
  const m = normalized.match(/^(\d+(?:\.\d+)?)\s*([a-zçãéí]*)$/)
  if (!m) return { ok: false, reason: 'INVALID' }

  const num = parseFloat(m[1])
  if (!Number.isFinite(num) || num <= 0) return { ok: false, reason: 'INVALID' }

  const suffix = m[2]
  const rules  = SUFFIX_RULES[articleUnit]
  // Defensivo: artigo legacy pode ter unit='kg'/'L' (não-canónico). Sem isto,
  // `rules.wrong` rebenta o form na primeira render. Tratar como INVALID
  // até alguém saneie o registo no DB.
  if (!rules) return { ok: false, reason: 'INVALID' }

  if (rules.wrong.has(suffix)) return { ok: false, reason: 'INCOMPATIBLE_UNIT' }
  const multiplier = rules.ok[suffix]
  if (multiplier === undefined) return { ok: false, reason: 'INVALID' }

  // Evitar artefactos de floating-point (e.g. 0.1 + 0.2 → 0.30000000000000004).
  return { ok: true, value: +(num * multiplier).toFixed(6) }
}

// Helper de copy para o input de "Cada embalagem traz". Adapta exemplos à
// unidade do artigo para o chef ver formatos válidos pertinentes.
export function packagingHelperText(unit: ArticleBaseUnit): string {
  if (unit === 'g')  return 'Ex: 10kg, 2,5kg, 500g, 3k'
  if (unit === 'mL') return 'Ex: 5L, 2,5L, 750ml'
  return 'Ex: 180un, 12, 6'
}

// Unidades de medida comuns em cozinha profissional
export const KITCHEN_UNITS = [
  // Peso
  'kg', 'g', 'mg',
  // Volume
  'L', 'mL', 'cl', 'dl',
  // Contagem
  'un', 'dose', 'porção', 'fatia', 'peça',
  // Embalagem
  'caixa', 'saco', 'frasco', 'lata', 'garrafa', 'pacote', 'balde', 'tabuleiro', 'bisnaga',
  // Outros
  'maço', 'folha', 'ramo', 'dente', 'colher', 'colher de sopa', 'colher de chá',
]
