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
// Lookbehind `(?<![\dx×])` impede match no meio de um número ou de uma
// dimensão "AxB" — espelha PACKAGING_RE em classifyLine.
const PACKAGING_RE_LOC = /(?<![\dx×])(\d+[.,]?\d*)\s*(cx|caixas?|sacos?|sacola|packs?|pacotes?|vasos?|fardos?|molhos?|maços?|ramos?|garrafas?|garrafão|latas?|frascos?|bisnaga|tabuleiros?|baldes?|bote|emb|embalagens?|conservas?|enlatad[oa]s?|blocos?)\b/i
const MULTIPACK_RE_LOC = /(\d+)\s*[x×]\s*(\d+[.,]?\d*)\s*(kg|g|mg|gr|grs|gramas?|litros?|mililitros?|lt[s]?|cl|dl|ml|mL|l)\b/i

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

// Canoniza CONTAINER_KEEP_IN_NAME para o sufixo display ("em lata"/"em conserva").
// 'enlatad…' → 'lata' (mesma canonicalização que PACKAGING_MAP em articleDraft.ts).
function containerSuffix(label: string): string {
  if (label.startsWith('enlatad')) return 'lata'
  if (label === 'latas')           return 'lata'
  if (label === 'conservas')       return 'conserva'
  return label
}

// Tokens que sinalizam unit='un' explícita; remover do nome após parsing.
const UNIT_QTY_TOKENS = new Set([
  'uni', 'unis', 'unid', 'unids',
  'unidade', 'unidades',
  'un',
])

// Tokens compactos "<n>un|uni|unid|unidade(s)" — ex: "6un", "12uni", "6unidades".
// classifyLine não os apanha (não são peso/volume nem bare number puro) e o
// filter !UNIT_QTY_TOKENS / !isBareNumber também não, porque misturam dígitos
// e letras. Este RE fecha o buraco — não match em "20x30" (tem 'x').
const COMPACT_UNIT_QTY_RE = /^\d+\.?\d*(un|uni|unis|unid|unids|unidade|unidades)$/i

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

/**
 * Trace mínimo da extração de nome — alimenta a camada de confiança
 * (`articleConfidence.ts`). Single flag: `strippedPackagingNoQty` indica
 * que o branch type='unit' encontrou uma container word E não havia
 * número adjacente — sinal fraco que pode ter perdido o produto
 * (ex: "caixa pizza" → "Pizza").
 *
 * Branches type='weight'/'volume'/'packaging' nunca disparam — esses
 * têm qty explícita ou label canónico que o parser tratou com confiança.
 */
export type ExtractNameTrace = {
  strippedPackagingNoQty: boolean
}

/**
 * Análise paralela ao branch type='unit' de `extractName`. Replica APENAS
 * a deteção de "há container word sem número adjacente?" — não reproduz
 * cleanup nem strip. Pure, side-effect-free.
 */
export function derivePackagingTrace(line: string, cl: ClassifiedLine): ExtractNameTrace {
  if (cl.type !== 'unit') return { strippedPackagingNoQty: false }

  const words        = line.split(/\s+/).filter(Boolean)
  const isBareNumber = (w: string) => /^\d+[.,]?\d*$/.test(w)
  const isContainer  = (w: string, idx: number, len: number) => {
    const lower = w.toLowerCase()
    if (!CONTAINER_CONTEXT_WORDS.includes(lower)) return false
    // Mesma excepção R-PATCH 2 que stripContainersAndBareNumbersList:
    // "molho" idx 0 com palavras a seguir é prefixo de nome.
    if ((lower === 'molho' || lower === 'molhos') && idx === 0 && len > 1) return false
    return true
  }

  let hasContainer = false
  for (let i = 0; i < words.length; i++) {
    if (!isContainer(words[i], i, words.length)) continue
    hasContainer = true
    let j = i + 1
    while (j < words.length && NAME_CONNECTORS.has(words[j].toLowerCase())) j++
    if (j < words.length && isBareNumber(words[j])) {
      // container + número adjacente: parser tem qty. Não é sinal fraco.
      return { strippedPackagingNoQty: false }
    }
  }
  return { strippedPackagingNoQty: hasContainer }
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
      // Container que é parte do produto (lata/conserva/enlatado).
      // R-PATCH: o comportamento anterior (`before || after || line`) descartava
      // o produto quando `before` continha apenas o label — "lata 2.5kg tomate
      // pelado" virava "Lata".
      //
      // Regra conservadora: só canonicalizar quando `before` é apenas o label
      // (ou vazio). Nesse caso, vamos buscar o produto a `after`, limpamos
      // residuais e sufixamos com "em <suffix>". Quando `before` já contém o
      // produto, preservamos para não regredir nomes existentes ("Atum
      // Conserva", "Atum Enlatado", "Atum em Lata").
      if (CONTAINER_KEEP_IN_NAME.has(cl.label)) {
        const beforeWords      = before.split(/\s+/).filter(Boolean)
        const beforeIsOnlyLabel = beforeWords.length === 0 ||
          (beforeWords.length === 1 && beforeWords[0].toLowerCase() === cl.label)

        if (!beforeIsOnlyLabel) {
          return before
        }

        const afterWords    = after.split(/\s+/).filter(Boolean)
        const idxLabelA     = afterWords.map(w => w.toLowerCase()).indexOf(cl.label)
        const afterStripped = idxLabelA >= 0
          ? stripLabelAndConnectors(afterWords, idxLabelA)
          : afterWords
        const afterClean    = stripContainersAndBareNumbersList(afterStripped)

        if (afterClean.length === 0) return cl.label
        return `${afterClean.join(' ')} em ${containerSuffix(cl.label)}`
      }
      // Label antes do qty: strip do label de `before`.
      const beforeWords = before.split(/\s+/).filter(Boolean)
      const idxBefore   = beforeWords.map(w => w.toLowerCase()).lastIndexOf(cl.label!)
      if (idxBefore >= 0) {
        const cleaned = stripLabelAndConnectors(beforeWords, idxBefore)
        return cleaned.join(' ').trim() || after || line
      }
      // Label depois do qty (multipack-equivalente "1lt caixa 6 uni …"):
      // strip do label + número adjacente + token "uni" em `after`.
      // O regex aceita o número solto ("4") OU colado ao suffix de contagem
      // ("6uni", "6un") OU colado ao suffix de peso/volume ("6l", "800g",
      // "1kg") — porque o classifyLine também interpreta esses como total
      // do pack na mesma família.
      const COUNT_TOKEN_RE = /^\d+[.,]?\d*(?:uni|unis|unid|unids|unidades?|un|kg|g|mg|gr|grs|gramas?|litros?|mililitros?|lt[s]?|cl|dl|ml|l)?$/i
      const afterWords = after.split(/\s+/).filter(Boolean)
      const idxAfter   = afterWords.map(w => w.toLowerCase()).indexOf(cl.label!)
      if (idxAfter >= 0) {
        let endIdx = idxAfter + 1
        if (endIdx < afterWords.length && COUNT_TOKEN_RE.test(afterWords[endIdx])) {
          endIdx++
          if (endIdx < afterWords.length && UNIT_QTY_TOKENS.has(afterWords[endIdx].toLowerCase())) {
            endIdx++
          }
        }
        const cleanedAfter = [...afterWords.slice(0, idxAfter), ...afterWords.slice(endIdx)]
        // Nested packaging: cl.label é o outer (já strippado de `after`).
        // O innerLabel ("pacote", "garrafa") está em `before` antes do qty —
        // tem de ser strippado também para não ficar pendurado no nome.
        let cleanedBefore = beforeWords
        const innerLabel = cl.multipack?.innerLabel
        if (innerLabel) {
          const innerIdx = beforeWords.map(w => w.toLowerCase()).lastIndexOf(innerLabel)
          if (innerIdx >= 0) cleanedBefore = stripLabelAndConnectors(beforeWords, innerIdx)
        }
        const result = [...cleanedBefore, ...cleanedAfter].join(' ').trim()
        return result || before || after || line
      }
      return beforeWords.join(' ') || after || line
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

  // type='unit' (com ou sem qty) — strip do par "container + número adjacente"
  // quando existe; senão strip de container words standalone.
  //
  // Por que adjacent-to-number e não primeiro-container-encontrado:
  //   "Sacos vacuo 20x30 caixa 100 uni" — "sacos" é o nome, não embalagem.
  //   Só "caixa 100" (container + número) é que representa a embalagem real.
  //
  // "20x30" é preservado porque o filtro de bare numbers usa /^\d+[.,]?\d*$/
  // (não casa com tokens que contêm 'x').
  const cleaned = stripContainersAndBareNumbersList(line.split(/\s+/).filter(Boolean))
  return cleaned.length > 0 ? cleaned.join(' ') : line
}

/**
 * Strip de "container + número adjacente" (par) ou container standalone como
 * fallback. Filtra também UNIT_QTY_TOKENS, bare numbers e tokens compactos como
 * "180uni". Reutilizada pelo branch CONTAINER_KEEP em extractName e pelo branch
 * type='unit'.
 */
function stripContainersAndBareNumbersList(words: string[]): string[] {
  const isBareNumber = (w: string) => /^\d+[.,]?\d*$/.test(w)
  // R-PATCH 2: "molho"/"molhos" no idx 0 com palavras a seguir é prefixo de
  // nome (ex: "molho inglês", "molho soja"), não embalagem. Sem este guard,
  // o fallback abaixo strippava "molho" e o nome ficava só "Inglês"/"Soja".
  // Em outras posições mantém-se o comportamento (pode ser unidade/bunch).
  const isContainer = (w: string, idx: number, len: number) => {
    const lower = w.toLowerCase()
    if (!CONTAINER_CONTEXT_WORDS.includes(lower)) return false
    if ((lower === 'molho' || lower === 'molhos') && idx === 0 && len > 1) {
      return false
    }
    return true
  }

  let removeStart = -1
  let removeEnd   = -1
  for (let i = 0; i < words.length; i++) {
    if (!isContainer(words[i], i, words.length)) continue
    let j = i + 1
    while (j < words.length && NAME_CONNECTORS.has(words[j].toLowerCase())) j++
    if (j < words.length && isBareNumber(words[j])) {
      removeStart = i
      removeEnd   = j + 1
      break
    }
  }

  let cleaned: string[]
  if (removeStart >= 0) {
    cleaned = [...words.slice(0, removeStart), ...words.slice(removeEnd)]
  } else {
    cleaned = words.filter((w, i) => !isContainer(w, i, words.length))
  }
  return cleaned
    .filter(w => !UNIT_QTY_TOKENS.has(w.toLowerCase()))
    .filter(w => !isBareNumber(w))
    .filter(w => !COMPACT_UNIT_QTY_RE.test(w))
}

// ── Palavras-contexto que indicam unit='un' quando não há quantidade explícita

// Mantido em sincronia com PACKAGING_LABELS (classifyLine) e PACKAGING_MAP
// (articleDraft). Divergir aqui causa "container word não strippada do nome"
// — ver caso "Manjericão vaso 1 uni" coberto em scripts/test-parser.ts.
//
// Excepção posicional: 'molho'/'molhos' no idx 0 com palavras a seguir é
// tratado como prefixo de nome (R-PATCH 2). Ver isContainer em
// stripContainersAndBareNumbersList. A lista permanece igual para que outras
// posições continuem a tratar "molho" como container word.
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
  'bloco', 'blocos',
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
  // Apanha também forma compacta "<n>un|uni|unidade(s)" (ex.: "Cebola 12un",
  // "Pão de leite 6un") — sem isto a unit caía no fallback do produto (g/mL).
  // Excepção: se peso/volume foi detectado primeiro, o "uni" é o count de
  // multipack-equivalente (ex.: "1lt caixa 6 uni leite m.g.") — base_unit
  // permanece g/mL.
  if (
    cl.type !== 'weight' &&
    cl.type !== 'volume' &&
    (
      /\b(uni|unis|unid|unids|unidade|unidades)\b/i.test(trimmed) ||
      /\b\d+\.?\d*(un|uni|unis|unid|unids|unidade|unidades)\b/i.test(trimmed)
    ) &&
    unit !== 'un'
  ) {
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
