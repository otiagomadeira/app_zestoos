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
const PACKAGING_RE_LOC = /(\d+[.,]?\d*)\s*(cx|caixas?|sacos?|sacola|packs?|pacotes?|vasos?|fardos?|molhos?|maços?|ramos?|garrafas?|garrafão|latas?|frascos?|bisnaga|tabuleiros?|baldes?|bote|emb|embalagens?|conservas?|enlatad[oa]s?)\b/i
const MULTIPACK_RE_LOC = /(\d+)\s*[x×]\s*(\d+[.,]?\d*)\s*(kg|g|mg|gr|grs|gramas?|litros?|mililitros?|lt[s]?|cl|dl|ml|mL|l)\b/i
const BARE_NUMBER_RE   = /^(\d+[.,]?\d*)\s+/

// Conectores PT removidos quando adjacentes a um label de embalagem stripped.
// 'em' incluído para limpar "Café em saco" → "Café" (não deixar "em" órfão).
const NAME_CONNECTORS = new Set(['de', 'da', 'do', 'dos', 'das', 'em'])

// Container words que são parte do PRODUTO, não da embalagem.
// "Atum em lata" / "Feijão em lata" / "Tomate em conserva" — manter no nome.
// supplierSeed.order_unit recebe na mesma 'lata'/'conserva' (compra-se em lata),
// mas o nome do artigo conserva o termo porque é assim que se reconhece o produto.
const CONTAINER_KEEP_IN_NAME = new Set([
  'lata', 'latas',
  'conserva', 'conservas',
  'enlatado', 'enlatada', 'enlatados', 'enlatadas',
])

// Tokens que sinalizam unit='un' explícita; remover do nome após parsing.
const UNIT_QTY_TOKENS = new Set([
  'uni', 'unis', 'unid', 'unids',
  'unidade', 'unidades',
  'un',
])

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
    // Tentar multipack ("6x1L") primeiro; senão weight/volume normal.
    // O match.index do multipack inclui o "6x" — necessário para que findAdjacentPackagingLabel
    // (em classifyLine) e a procura de label aqui apanhem o container word ANTES do "6x".
    let match: RegExpMatchArray | null = line.match(MULTIPACK_RE_LOC)
    if (!match || match.index === undefined) {
      const re = cl.type === 'weight' ? WEIGHT_RE_LOC : VOLUME_RE_LOC
      match = line.match(re)
    }
    if (!match || match.index === undefined) return line

    const before = line.slice(0, match.index).trim()
    const after  = line.slice(match.index + match[0].length).trim()

    if (cl.label) {
      // Container que é parte do produto (lata/conserva/enlatado) → manter no nome
      if (CONTAINER_KEEP_IN_NAME.has(cl.label)) {
        return before || after || line
      }
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
    const stripped = line.replace(BARE_NUMBER_RE, '').trim() || line
    const cleaned  = stripped
      .split(/\s+/)
      .filter(w => !UNIT_QTY_TOKENS.has(w.toLowerCase()))
      .join(' ')
    return cleaned || stripped
  }

  // type='unit', normalized=false (sem número) — strip container words + número avulso + uni tokens
  // Cobre: "Mel frasco" → "Mel"; "Ovo caixa 180 uni" → "Ovo"; "Manjericão vaso 1 uni" → "Manjericão"
  const words = line.split(/\s+/).filter(Boolean)
  const idx   = words.findIndex(w => CONTAINER_CONTEXT_WORDS.includes(w.toLowerCase()))
  if (idx >= 0) {
    const stripped = stripLabelAndConnectors(words, idx)
    const cleaned  = stripped
      .filter(w => !/^\d+[.,]?\d*$/.test(w))
      .filter(w => !UNIT_QTY_TOKENS.has(w.toLowerCase()))
    return cleaned.length > 0 ? cleaned.join(' ') : line
  }
  const cleaned = words
    .filter(w => !CONTAINER_CONTEXT_WORDS.includes(w.toLowerCase()))
    .filter(w => !UNIT_QTY_TOKENS.has(w.toLowerCase()))
  return cleaned.length > 0 ? cleaned.join(' ') : line
}

// ── Palavras-contexto que indicam unit='un' quando não há quantidade explícita

// Mantido em sincronia com PACKAGING_LABELS (classifyLine) e PACKAGING_MAP
// (articleDraft). Divergir aqui causa "container word não strippada do nome"
// — ver caso "Manjericão vaso 1 uni" coberto em scripts/test-parser.ts.
const CONTAINER_CONTEXT_WORDS = [
  'lata', 'latas', 'frasco', 'frascos', 'bisnaga',
  'conserva', 'conservas',
  'enlatado', 'enlatada', 'enlatados', 'enlatadas',
  'caixa', 'caixas', 'cx',
  'saco', 'sacos', 'sacola',
  'embalagem', 'embalagens', 'emb',
  'balde', 'baldes',
  'pack', 'packs', 'pacote', 'pacotes',
  'garrafa', 'garrafas', 'garrafão',
  'tabuleiro', 'tabuleiros',
  'vaso', 'vasos',
  'fardo', 'fardos',
  'molho', 'molhos',
  'maço', 'maços',
  'ramo', 'ramos',
  'bote',
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

  // Override: token explícito "uni"/"unidade(s)" no input → forçar unit='un'.
  // Resolve "Alface iceberg caixa 12 uni" (caía em fallback 'g') e "Manjericão vaso 1 uni".
  if (/\b(uni|unis|unid|unids|unidade|unidades)\b/i.test(trimmed) && unit !== 'un') {
    unit = 'un'
    unitFromFallback = false
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
