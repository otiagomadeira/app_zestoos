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
  type ArticleWarning,
} from './normalizeArticle'

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type SupplierSeed = {
  /** Nome canónico da unidade de compra: 'frasco', 'caixa', 'garrafa', etc. */
  order_unit?: string
  /** Quantas unidades base (g/mL/un) cabem numa order_unit. */
  conversion_factor?: number
  /** 'detected' = parser extraiu do input; 'inferred' = heurística aplicou. */
  source: 'detected' | 'inferred'
}

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
