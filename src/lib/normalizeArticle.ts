/**
 * Pipeline única de normalização de artigos.
 *
 * Qualquer canal de entrada (manual, bulk, futuro PDF/Excel/foto) passa
 * por normalizeArticleInput antes de qualquer escrita na base de dados.
 *
 * NÃO gere wasManuallyEdited — esse é estado da UI (ArticleForm / BulkImportPanel).
 * NÃO usa extractedQty/extractedLabel para stock, par_level ou conversões.
 */

import { classifyLine, type ClassifiedLine } from './classifyLine'
import { normalizeName, normalizeKey } from './ingredientDictionary'
import { suggestCategory, suggestUnit } from './categoryKeywords'

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type ArticleWarning =
  | 'LOW_CATEGORY_CONFIDENCE'   // categoria inferida com baixa confiança
  | 'UNIT_FALLBACK'             // unidade inferida de keyword, não de quantidade explícita
  | 'NAME_NORMALIZED'           // nome foi alterado pelo dicionário ou aliases

export interface NormalizedArticleInput {
  name: string              // nome canónico (DICT + aliases aplicados)
  normalizedKey: string     // accent-free lowercase — usar para dedup client-side
  unit: 'g' | 'mL' | 'un'  // unidade base
  category: string | null
  categoryConfident: boolean
  categoryReason?: string
  extractedQty?: number     // auxiliar — não usar para stock/par_level/conversões
  extractedLabel?: string   // auxiliar — não usar para criar embalagem oficial
  warnings: ArticleWarning[]
}

// ── Utilitários exportados (reutilizados por parseProductLines) ───────────────

export function toTitleCase(s: string): string {
  return s
    .trim()
    .replace(/\S+/g, w => w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)
}

export function cleanName(s: string): string {
  return s.replace(/[.,;:!?]+$/, '').trim()
}

// Regexes de localização posicional (espelham classifyLine para extração de nome)
const WEIGHT_RE_LOC    = /(\d+[.,]?\d*)\s*(kg|g|mg|gr|grs|gramas?)\b/i
const VOLUME_RE_LOC    = /(\d+[.,]?\d*)\s*(litros?|mililitros?|lt[s]?|cl|dl|ml|mL|l)\b/i
const PACKAGING_RE_LOC = /(\d+[.,]?\d*)\s*(cx|caixas?|sacos?|sacola|packs?|pacotes?|vasos?|fardos?|molhos?|maços?|ramos?|garrafas?|garrafão|latas?|frascos?|bisnaga|tabuleiros?|baldes?|bote|emb|embalagens?)\b/i
const BARE_NUMBER_RE   = /^(\d+[.,]?\d*)\s+/

export function extractName(line: string, cl: ClassifiedLine): string {
  if (cl.type === 'weight' || cl.type === 'volume') {
    const re    = cl.type === 'weight' ? WEIGHT_RE_LOC : VOLUME_RE_LOC
    const match = line.match(re)
    if (!match || match.index === undefined) return line
    const before = line.slice(0, match.index).trim()
    const after  = line.slice(match.index + match[0].length).trim()
    if (cl.label) {
      const words = before.split(/\s+/).filter(Boolean)
      const idx   = words.map(w => w.toLowerCase()).lastIndexOf(cl.label!)
      if (idx >= 0) words.splice(idx, 1)
      return words.join(' ') || after || line
    }
    return before || after || line
  }

  if (cl.type === 'packaging') {
    const match = line.match(PACKAGING_RE_LOC)
    if (!match || match.index === undefined) return line
    const before = line.slice(0, match.index).trim()
    const after  = line.slice(match.index + match[0].length).trim()
    return before || after || line
  }

  if (cl.type === 'unit' && cl.qty > 0) {
    return line.replace(BARE_NUMBER_RE, '').trim() || line
  }

  // type='unit', normalized=false (sem número) — strip container words (ex: "Mel frasco" → "Mel")
  const words   = line.split(/\s+/).filter(Boolean)
  const cleaned = words.filter(w => !CONTAINER_CONTEXT_WORDS.includes(w.toLowerCase()))
  return (cleaned.length > 0 ? cleaned.join(' ') : line)
}

// ── Palavras-contexto que indicam unit='un' quando não há quantidade explícita

const CONTAINER_CONTEXT_WORDS = [
  'lata', 'latas', 'frasco', 'frascos', 'bisnaga',
  'conserva', 'conservas', 'enlatado', 'enlatada',
  'caixa', 'caixas', 'cx',
  'saco', 'sacos', 'sacola',
  'embalagem', 'embalagens', 'emb',
  'balde', 'baldes',
  'pacote', 'pacotes',
  'garrafa', 'garrafas', 'garrafão',
  'tabuleiro', 'tabuleiros',
]

// ── API pública ───────────────────────────────────────────────────────────────

export function normalizeArticleInput(
  raw: string,
  aliases?: Map<string, string>,
): NormalizedArticleInput {
  const trimmed = raw.trim()
  const cl      = classifyLine(trimmed)

  // Extrair e limpar nome
  const rawExtracted = extractName(trimmed, cl)
  const titleName    = cleanName(toTitleCase(rawExtracted))

  // Normalizar via DICT + aliases
  const name          = normalizeName(titleName || trimmed, aliases)
  const normalizedKey = normalizeKey(name)
  const nameNormalized = titleName.length > 0 && name !== titleName

  // Determinar unidade base
  let unit: 'g' | 'mL' | 'un' = cl.base_unit
  let unitFromFallback = false

  if (cl.type === 'unit' && !cl.normalized) {
    // Sem quantidade explícita no input — inferir unidade por contexto
    const lowerRaw = trimmed.toLowerCase()
    const hasContainer = CONTAINER_CONTEXT_WORDS.some(w => {
      const re = new RegExp(`\\b${w}\\b`)
      return re.test(lowerRaw)
    })

    if (hasContainer) {
      unit = 'un'
    } else {
      const suggested = suggestUnit(name)
      if (suggested) {
        unit = suggested
        unitFromFallback = suggested !== 'g'  // 'g' é o default sólido, não é fallback incerto
      }
    }
  }

  // Sugerir categoria com contexto completo
  const catResult = suggestCategory({
    name,
    unit,
    label: cl.label ?? undefined,
    raw: trimmed,
  })

  const warnings: ArticleWarning[] = []
  if (!catResult.confident)  warnings.push('LOW_CATEGORY_CONFIDENCE')
  if (unitFromFallback)      warnings.push('UNIT_FALLBACK')
  if (nameNormalized)        warnings.push('NAME_NORMALIZED')

  return {
    name,
    normalizedKey,
    unit,
    category:          catResult.category,
    categoryConfident: catResult.confident,
    categoryReason:    catResult.reason,
    extractedQty:      cl.qty > 0 ? cl.qty : undefined,
    extractedLabel:    cl.label ?? undefined,
    warnings,
  }
}
