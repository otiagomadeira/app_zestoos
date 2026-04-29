/**
 * Motor único de criação de artigos.
 *
 * Todos os canais (manual, bulk, futuramente PDF/Excel/foto) DEVEM passar
 * por buildArticleDraft. Mesmo input → mesmo ArticleDraft, sempre.
 *
 * Pipeline: raw → classifyLine + extractName + supplierSeed → ArticleDraft
 *
 * Não escreve em base de dados. Não sabe de UI. É puro.
 */

import { classifyLine } from './classifyLine'
import {
  normalizeArticleInput,
  toTitleCase,
  cleanName,
  extractName,
  derivePackagingTrace,
  type ArticleWarning,
} from './normalizeArticle'
import {
  assessConfidence,
  type ConfidenceLevel,
  type ConfidenceReason,
} from './articleConfidence'

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type SupplierSeed = {
  /** Nome canónico da unidade de compra: 'frasco', 'caixa', 'garrafa', etc. */
  order_unit?: string
  /** Quantas unidades base (g/mL/un) cabem numa order_unit. */
  conversion_factor?: number
  /** 'detected' = parser extraiu do input; 'inferred' = heurística aplicou. */
  source: 'detected' | 'inferred'
}

/**
 * Discriminador de intenção do artigo, derivado puramente de unit + supplierSeed.
 *
 * Existe para o ArticleForm decidir, sem ler fornecedores nem article_sizes,
 * em que unidade visual deve aceitar o stock mínimo:
 *   COUNTABLE_UNIT       → un
 *   WEIGHT_LOOSE         → kg (visual) → g (DB)
 *   VOLUME               → L  (visual) → mL (DB)
 *   PACKAGED_WEIGHT      → orderUnit (caixa, saco...) → g (DB)
 *   PACKAGED_VOLUME      → orderUnit                  → mL (DB)
 *   COUNTABLE_PACKAGED   → orderUnit                  → un (DB)
 *
 * Não é persistido. Não conhece DB. Só conhece o que `classifyLine` produziu.
 */
export type ArticleIntent =
  | { kind: 'COUNTABLE_UNIT' }
  | { kind: 'WEIGHT_LOOSE' }
  | { kind: 'VOLUME' }
  | { kind: 'PACKAGED_WEIGHT';   orderUnit: string; basePerOrder: number; multipack?: { count: number; perPack: number; innerLabel?: string } }
  | { kind: 'PACKAGED_VOLUME';   orderUnit: string; basePerOrder: number; multipack?: { count: number; perPack: number; innerLabel?: string } }
  | { kind: 'COUNTABLE_PACKAGED'; orderUnit: string; perPack: number }

export type ArticleDraft = {
  rawInput:          string
  /** Nome canónico (DICT + aliases aplicados) */
  name:              string
  /** Nome após extract+title-case mas antes do DICT — usado para learn alias */
  originalName:      string
  /** accent-free lowercase para dedup client-side */
  normalizedKey:     string
  unit:              'g' | 'mL' | 'un'
  category:          string | null
  categoryConfident: boolean
  categoryReason?:   string
  supplierSeed?:     SupplierSeed
  warnings:          ArticleWarning[]
  /** Quantidade detetada em unidades base (auxiliar — para hint UX) */
  detected_qty?:     number
  /** Label de embalagem detetada (auxiliar — para hint UX) */
  detected_label?:   string
  /**
   * Multipack detetado ("6x1L"): preserva count × perPack para UX.
   * Apenas afeta o hint visual; conversion_factor permanece = count × perPack
   * em base_unit. Não usado para cálculos de stock/encomenda.
   */
  detected_multipack?: { count: number; perPack: number }
  /** Intenção derivada (puro). Driver de UX para escolher a unidade do par_level. */
  intent: ArticleIntent
  /** Camada de confiança operacional. UI consome para decidir se mostrar pill / dot / contador. */
  confidence:        ConfidenceLevel
  confidenceReasons: ConfidenceReason[]
  /** Conveniência: confidence === 'low'. Mantido como campo para o consumidor não duplicar lógica. */
  needsReview:       boolean
}

// ── Inferência de intenção ────────────────────────────────────────────────────

/**
 * Deriva a intenção de um artigo a partir do `unit` final, do `supplierSeed`
 * e (opcional) do multipack detetado pelo parser.
 *
 * Pura, idempotente, sem heurísticas extra: não inventa packaging, não infere
 * "operational unit" para palavras desconhecidas.
 *
 * Quando há `order_unit` MAS `conversion_factor` em falta (ex: "2 caixas"
 * sem peso), cai para *_LOOSE/COUNTABLE_UNIT — não fingimos saber a
 * embalagem. O fornecedor mais tarde pode confirmar.
 *
 * Multipack: anexado às variantes PACKAGED_WEIGHT/PACKAGED_VOLUME quando
 * `count > 1` e `perPack > 0`. Permite a getCountingModeOptions oferecer
 * a alternativa "unidade individual". COUNTABLE_PACKAGED é deliberadamente
 * excluído (caso "ovos caixa 180 uni" não pede contagem por unidade).
 */
export function inferIntent(args: {
  unit:          'g' | 'mL' | 'un'
  supplierSeed?: SupplierSeed
  multipack?:    { count: number; perPack: number; innerLabel?: string }
}): ArticleIntent {
  const { unit, supplierSeed, multipack } = args
  const orderUnit = supplierSeed?.order_unit
  const factor    = supplierSeed?.conversion_factor

  const mp = multipack && multipack.count > 1 && multipack.perPack > 0
    ? {
        count:    multipack.count,
        perPack:  multipack.perPack,
        ...(multipack.innerLabel ? { innerLabel: multipack.innerLabel } : {}),
      }
    : undefined

  if (orderUnit && factor != null && factor > 0) {
    if (unit === 'g')  return { kind: 'PACKAGED_WEIGHT',   orderUnit, basePerOrder: factor, ...(mp ? { multipack: mp } : {}) }
    if (unit === 'mL') return { kind: 'PACKAGED_VOLUME',   orderUnit, basePerOrder: factor, ...(mp ? { multipack: mp } : {}) }
    return                       { kind: 'COUNTABLE_PACKAGED', orderUnit, perPack: factor }
  }

  if (unit === 'g')  return { kind: 'WEIGHT_LOOSE' }
  if (unit === 'mL') return { kind: 'VOLUME' }
  return                     { kind: 'COUNTABLE_UNIT' }
}

// ── Modo de contagem (UI) ─────────────────────────────────────────────────────

export type CountingMode = {
  /** Unidade visível ao chef: 'kg', 'L', 'un', 'caixa', 'saco', ... */
  count_unit:     string
  /** Quantas unidades base (g/mL/un) cabem em 1 count_unit. */
  base_per_unit:  number
  /** True quando count_unit é o default da família (kg/L/un) sem packaging — sinaliza que adicionar fornecedor/tamanho dá precisão. Não bloqueia. */
  needs_supplier: boolean
}

/**
 * Como o chef conta este artigo na prática. Pure. Deriva de:
 *   1. article_sizes (fonte estável e persistida; primeiro sort_order ganha)
 *   2. ArticleIntent (parser inference)
 *   3. base_unit (fallback dentro do switch)
 *
 * Single source of truth para o bloco "Formatos de uso" na UI. Não inventa packaging:
 * se intent é WEIGHT_LOOSE/VOLUME/COUNTABLE_UNIT e não há size, o count cai no
 * default da família e marca `needs_supplier=true`.
 */
export function getCountingMode(args: {
  intent:        ArticleIntent
  articleSizes?: { label: string; base_per_unit: number }[]
}): CountingMode {
  const { intent, articleSizes } = args

  if (articleSizes && articleSizes.length > 0) {
    const s = articleSizes[0]
    return { count_unit: s.label, base_per_unit: s.base_per_unit, needs_supplier: false }
  }

  switch (intent.kind) {
    case 'WEIGHT_LOOSE':
      return { count_unit: 'kg', base_per_unit: 1000, needs_supplier: true }
    case 'VOLUME':
      return { count_unit: 'L',  base_per_unit: 1000, needs_supplier: true }
    case 'COUNTABLE_UNIT':
      return { count_unit: 'un', base_per_unit: 1,    needs_supplier: true }
    case 'PACKAGED_WEIGHT':
    case 'PACKAGED_VOLUME':
      return { count_unit: intent.orderUnit, base_per_unit: intent.basePerOrder, needs_supplier: false }
    case 'COUNTABLE_PACKAGED':
      return { count_unit: intent.orderUnit, base_per_unit: intent.perPack, needs_supplier: false }
  }
}

/**
 * Devolve o conjunto de modos de contagem disponíveis. O primeiro elemento é
 * sempre o default (= `getCountingMode`). Há uma alternativa quando o input
 * descreve um multipack com peso/volume conhecido por unidade individual:
 *
 *   "leite 1L pack 6uni" → [{ pack, 6000 }, { unidade, 1000 }]
 *   "frango caixa 10kg"  → [{ caixa, 10000 }]   // sem multipack, só primary
 *   "ovos caixa 180 uni" → [{ caixa, 180 }]     // COUNTABLE_PACKAGED não tem alt
 *   "frango 10kg"        → [{ kg, 1000 }]       // WEIGHT_LOOSE
 *
 * article_sizes vence sempre — chef já fixou. UI consome com toggle pill quando
 * length > 1.
 */
export function getCountingModeOptions(args: {
  intent:        ArticleIntent
  articleSizes?: { label: string; base_per_unit: number }[]
}): CountingMode[] {
  const primary = getCountingMode(args)

  // Multi-size: cada article_size é um chip independente (formatos de uso
  // que o chef já gravou). Length=1 dá comportamento idêntico ao anterior
  // (`[primary]`). Length>1 alimenta o toggle de chips em FORMATOS DE USO.
  if (args.articleSizes && args.articleSizes.length > 0) {
    return args.articleSizes.map(s => ({
      count_unit:     s.label,
      base_per_unit:  s.base_per_unit,
      needs_supplier: false,
    }))
  }

  if ((args.intent.kind === 'PACKAGED_WEIGHT' || args.intent.kind === 'PACKAGED_VOLUME')
      && args.intent.multipack) {
    const { perPack, innerLabel } = args.intent.multipack
    // Nested packaging: usa o label interno escrito pelo chef ("pacote",
    // "garrafa") em vez de "unidade" genérico. Para multipack simples
    // ("6uni"), innerLabel é undefined → fica "unidade".
    return [
      primary,
      { count_unit: innerLabel ?? 'unidade', base_per_unit: perPack, needs_supplier: false },
    ]
  }

  return [primary]
}

// ── Constantes internas ───────────────────────────────────────────────────────

// Variantes → label canónico. Sincronizado com classifyLine.PACKAGING_LABELS.
const PACKAGING_MAP: Record<string, string> = {
  cx: 'caixa', caixa: 'caixa', caixas: 'caixa',
  saco: 'saco', sacos: 'saco', sacola: 'saco',
  pack: 'pack', packs: 'pack', pacote: 'pacote', pacotes: 'pacote',
  vaso: 'vaso', vasos: 'vaso',
  fardo: 'fardo', fardos: 'fardo',
  molho: 'molho', molhos: 'molho',
  maço: 'maço', maços: 'maço',
  ramo: 'ramo', ramos: 'ramo',
  garrafa: 'garrafa', garrafas: 'garrafa', garrafão: 'garrafa',
  lata: 'lata', latas: 'lata',
  frasco: 'frasco', frascos: 'frasco',
  bisnaga: 'bisnaga',
  tabuleiro: 'tabuleiro', tabuleiros: 'tabuleiro',
  balde: 'balde', baldes: 'balde',
  bote: 'bote',
  emb: 'embalagem', embalagem: 'embalagem', embalagens: 'embalagem',
  // 'enlatado' (em todas as flexões) é forma de descrever "lata" — canonicalizar.
  enlatado: 'lata', enlatada: 'lata', enlatados: 'lata', enlatadas: 'lata',
  // 'conserva' fica como label próprio: tipo de produto distinto, sem assumir 'lata'.
  conserva: 'conserva', conservas: 'conserva',
  bloco: 'bloco', blocos: 'bloco',
}

const CONNECTORS = new Set(['de', 'da', 'do', 'dos', 'das'])

/**
 * Apanha "label adjacente a um número avulso" — caso `Ovo Caixa 180`.
 * O classifyLine não cobre isto porque PACKAGING_RE exige "número antes do label".
 * Aqui procuramos label primeiro, depois um número (com conectores PT a separar).
 */
function findLabelAdjacentNumber(
  raw: string,
): { label: string; qty: number } | null {
  const words = raw.trim().split(/\s+/).filter(Boolean)
  for (let i = 0; i < words.length; i++) {
    const lc = words[i].toLowerCase()
    if (!(lc in PACKAGING_MAP)) continue
    let j = i + 1
    while (j < words.length && CONNECTORS.has(words[j].toLowerCase())) j++
    const next = words[j]
    if (next && /^\d+[.,]?\d*$/.test(next)) {
      return { label: PACKAGING_MAP[lc], qty: parseFloat(next.replace(',', '.')) }
    }
  }
  return null
}

// ── API pública ───────────────────────────────────────────────────────────────

export function buildArticleDraft(
  raw: string,
  aliases?: Map<string, string>,
): ArticleDraft {
  const trimmed    = raw.trim()
  const cl         = classifyLine(trimmed)
  const normalized = normalizeArticleInput(trimmed, aliases)

  // Recalcular originalName (pré-DICT) — necessário para learnAlias
  const rawExtracted = extractName(trimmed, cl)
  const originalName = cleanName(toTitleCase(rawExtracted))

  // ── Construir supplierSeed ─────────────────────────────────────────────────
  let supplierSeed: SupplierSeed | undefined
  let detectedQty:       number | undefined
  let detectedLabel:     string | undefined
  let detectedMultipack: { count: number; perPack: number } | undefined

  if (cl.type === 'weight' || cl.type === 'volume') {
    detectedQty       = cl.qty
    detectedMultipack = cl.multipack
    if (cl.label) {
      const canonical = PACKAGING_MAP[cl.label] ?? cl.label
      detectedLabel = canonical
      supplierSeed = {
        order_unit:        canonical,
        conversion_factor: cl.qty,
        source:            'detected',
      }
    }
  } else if (cl.type === 'packaging') {
    // "2 caixas" — sabemos order_unit, não o conteúdo.
    const canonical = PACKAGING_MAP[cl.label!] ?? cl.label!
    detectedLabel   = canonical
    supplierSeed    = { order_unit: canonical, source: 'detected' }
  } else {
    // type='unit' (com ou sem número) — tentar "container + bare number"
    const labelHit = findLabelAdjacentNumber(trimmed)
    if (labelHit) {
      detectedLabel = labelHit.label
      detectedQty   = labelHit.qty
      supplierSeed  = {
        order_unit:        labelHit.label,
        conversion_factor: labelHit.qty,
        source:            'detected',
      }
    } else if (cl.type === 'unit' && cl.normalized) {
      // Número avulso ("5 ovos") — qty conhecida mas sem packaging
      detectedQty = cl.qty
    }
  }

  const intent = inferIntent({ unit: normalized.unit, supplierSeed, multipack: detectedMultipack })

  // ── Camada de confiança ────────────────────────────────────────────────────
  const trace   = derivePackagingTrace(trimmed, cl)
  const verdict = assessConfidence({
    rawInput:          trimmed,
    finalName:         normalized.name,
    category:          normalized.category,
    categoryConfident: normalized.categoryConfident,
    intent,
    trace,
    detectedLabel,
    detectedQty,
  })

  return {
    rawInput:           raw,
    name:               normalized.name,
    originalName,
    normalizedKey:      normalized.normalizedKey,
    unit:               normalized.unit,
    category:           normalized.category,
    categoryConfident:  normalized.categoryConfident,
    categoryReason:     normalized.categoryReason,
    supplierSeed,
    warnings:           normalized.warnings,
    detected_qty:       detectedQty,
    detected_label:     detectedLabel,
    detected_multipack: detectedMultipack,
    intent,
    confidence:         verdict.confidence,
    confidenceReasons:  verdict.reasons,
    needsReview:        verdict.needsReview,
  }
}

/**
 * Formata as informações detetadas como hint legível.
 * Converte unidades base para display (1000g → "1 kg", 750mL → "750 mL").
 * Para multipack ("6x1L"), preserva o formato "6 x 1 L" reconhecível pelo chef
 * em vez de simplificar para o total ("6 L").
 * Devolve null se nada foi extraído.
 */
export function formatDraftHint(draft: ArticleDraft): string | null {
  const parts: string[] = []

  if (draft.detected_multipack) {
    const { count, perPack } = draft.detected_multipack
    parts.push(`${count} x ${formatBaseQty(perPack, draft.unit)}`)
  } else if (draft.detected_qty != null && draft.detected_qty > 0) {
    parts.push(formatBaseQty(draft.detected_qty, draft.unit))
  }

  if (draft.detected_label) parts.push(draft.detected_label)
  return parts.length ? parts.join(' · ') : null
}

function formatBaseQty(qty: number, unit: 'g' | 'mL' | 'un'): string {
  if (unit === 'g') {
    return qty >= 1000 ? `${+(qty / 1000).toFixed(2)} kg` : `${qty} g`
  }
  if (unit === 'mL') {
    return qty >= 1000 ? `${+(qty / 1000).toFixed(2)} L` : `${qty} mL`
  }
  return String(qty)
}
