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

// Preposições/artigos PT que ficam em minúsculas (exceto na 1ª palavra)
const PT_LOWERCASE_WORDS = new Set([
  'de', 'da', 'do', 'dos', 'das',
  'e', 'em', 'na', 'no', 'nas', 'nos',
  'a', 'o', 'as', 'os',
  'para', 'com',
])

export function toTitleCase(s: string): string {
  const trimmed = s.trim()
  if (!trimmed) return trimmed
  return trimmed
    .split(/\s+/)
    .map((w, i) => {
      if (!w) return w
      const lc = w.toLowerCase()
      // Não-primeira palavra que seja preposição/artigo → minúscula
      if (i > 0 && PT_LOWERCASE_WORDS.has(lc)) return lc
      return w[0].toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(' ')
}

export function cleanName(s: string): string {
  return s.replace(/[.,;:!?]+$/, '').trim()
}

// Regexes de localização posicional (espelham classifyLine para extração de nome)
const WEIGHT_RE_LOC    = /(\d+[.,]?\d*)\s*(kg|g|mg|gr|grs|gramas?)\b/i
const VOLUME_RE_LOC    = /(\d+[.,]?\d*)\s*(litros?|mililitros?|lt[s]?|cl|dl|ml|mL|l)\b/i
const PACKAGING_RE_LOC = /(\d+[.,]?\d*)\s*(cx|caixas?|sacos?|sacola|packs?|pacotes?|vasos?|fardos?|molhos?|maços?|ramos?|garrafas?|garrafão|latas?|frascos?|bisnaga|tabuleiros?|baldes?|bote|emb|embalagens?)\b/i
const BARE_NUMBER_RE   = /^(\d+[.,]?\d*)\s+/

// Conectores PT removidos quando adjacentes a um label de embalagem stripped
const NAME_CONNECTORS = new Set(['de', 'da', 'do', 'dos', 'das'])

// Strip da palavra em `idx` + conectores adjacentes em ambos os lados
function stripLabelAndConnectors(words: string[], idx: number): string[] {
  let start = idx
  let end   = idx + 1
  while (end < words.length && NAME_CONNECTORS.has(words[end].toLowerCase())) end++
  while (start > 0 && NAME_CONNECTORS.has(words[start - 1].toLowerCase())) start--
  const out = [...words]
  out.splice(start, end - start)
  return out
}

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
      if (idx >= 0) {
        const cleaned = stripLabelAndConnectors(words, idx)
        return cleaned.join(' ').trim() || after || line
      }
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

  // type='unit', normalized=false (sem número) — strip container words + número avulso
  // Cobre: "Mel frasco" → "Mel"; "Ovo Caixa 180" → "Ovo"
  const words = line.split(/\s+/).filter(Boolean)
  const idx   = words.findIndex(w => CONTAINER_CONTEXT_WORDS.includes(w.toLowerCase()))
  if (idx >= 0) {
    const stripped = stripLabelAndConnectors(words, idx)
    // Remove qualquer número solto que tenha sobrado (ex: "180" depois de "Caixa")
    const cleaned = stripped.filter(w => !/^\d+[.,]?\d*$/.test(w))
    return cleaned.length > 0 ? cleaned.join(' ') : line
  }
  // Fallback antigo: filter inline (sem strip de conectores ou números)
  const cleaned = words.filter(w => !CONTAINER_CONTEXT_WORDS.includes(w.toLowerCase()))
  return cleaned.length > 0 ? cleaned.join(' ') : line
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
  // Regra: container words (frasco, saco, lata…) = order_unit, nunca base_unit.
  let unit: 'g' | 'mL' | 'un'
  let unitFromFallback = false

  if (cl.type === 'weight') {
    unit = 'g'
  } else if (cl.type === 'volume') {
    unit = 'mL'
  } else if (cl.type === 'unit' && cl.normalized) {
    // Número avulso sem unidade (ex: "5 ovos") = contagem
    unit = 'un'
  } else {
    // packaging | unit sem número — inferir base_unit do produto, ignorar container words
    const kw = suggestUnit(name)
    unit = kw ?? 'g'
    unitFromFallback = !!kw && kw !== 'g'
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
