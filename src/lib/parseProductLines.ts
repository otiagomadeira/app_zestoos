import { classifyLine } from './classifyLine'
import { normalizeKey } from './ingredientDictionary'
import { normalizeArticleInput, toTitleCase, cleanName, extractName, type ArticleWarning } from './normalizeArticle'

export type ParsedLine = {
  id: string
  rawLine: string
  name: string
  originalName: string      // nome tal como o parser extraiu, antes de edições do utilizador
  qty: string               // qty numérica extraída (referência, não usada na criação)
  unit: string              // base_unit (g, mL, un…)
  stock_unit: string        // unidade de stock (saco, molho…); '' = igual a unit
  base_per_order: string    // base_units por order_unit (para fornecedor); '' = não configurado
  par_level: string
  category: string
  suggestedCategory: string | null
  categoryConfident: boolean
  warnings: ArticleWarning[]
  wasManuallyEdited: boolean // true quando utilizador alterou o nome no preview
  confidence: 'ok' | 'partial'
  isDuplicate: boolean
  isDuplicateInBatch: boolean
  existingArticleId?: string
  deleted: boolean
}

// ── Parser de linha única ────────────────────────────────────────────────────
// Responsável por extrair qty, stock_unit, base_per_order e confidence.
// A normalização de nome/categoria é delegada para normalizeArticleInput.

function parseSingleLine(
  raw: string,
): Omit<ParsedLine, 'id' | 'name' | 'category' | 'suggestedCategory' | 'categoryConfident' | 'warnings' | 'isDuplicate' | 'isDuplicateInBatch' | 'existingArticleId' | 'deleted' | 'wasManuallyEdited'> | null {
  const line = raw.trim()
  if (!line) return null

  // Ignorar linhas que são só números
  if (/^\d+([.,]\d+)?$/.test(line)) return null

  const cl      = classifyLine(line)
  const rawName = extractName(line, cl)
  const name    = cleanName(toTitleCase(rawName))
  if (!name) return null

  // Error → partial (UI bloqueia criação)
  if (cl.type === 'error') {
    return {
      rawLine:        raw,
      originalName:   name,
      qty:            '',
      unit:           '',
      stock_unit:     '',
      base_per_order: '',
      par_level:      '0',
      confidence:     'partial',
    }
  }

  const unit = cl.base_unit
  const qty  = cl.qty > 0 ? String(cl.qty) : ''

  let stock_unit    = ''
  let base_per_order = ''

  if (cl.type === 'packaging') {
    stock_unit    = cl.label ?? ''
    base_per_order = ''
  } else if ((cl.type === 'weight' || cl.type === 'volume') && cl.label) {
    stock_unit    = cl.label
    base_per_order = qty
  }

  const confidence: 'ok' | 'partial' = name.length > 0 && cl.normalized ? 'ok' : 'partial'

  return {
    rawLine:       raw,
    originalName:  name,
    qty,
    unit,
    stock_unit,
    base_per_order,
    par_level:  '0',
    confidence,
  }
}

// ── API pública ──────────────────────────────────────────────────────────────

export function parseProductLines(
  rawText: string,
  existingArticles: { id: string; name: string }[] = [],
  orgAliases?: Map<string, string>
): ParsedLine[] {
  const existingMap = new Map(
    existingArticles.map(a => [normalizeKey(a.name), a.id])
  )

  const seenInBatch = new Map<string, number>()
  const results: ParsedLine[] = []

  const lines = rawText.split('\n')

  for (const rawLine of lines) {
    const parsed = parseSingleLine(rawLine)
    if (!parsed) continue

    // Delegar normalização de nome, categoria e unidade à pipeline única
    const normalized     = normalizeArticleInput(rawLine, orgAliases)
    const name           = normalized.name
    const key            = normalized.normalizedKey
    const existingId     = existingMap.get(key)
    const batchDupIdx    = seenInBatch.get(key)

    // Preservar unit extraída pela pipeline (pode diferir de cl.base_unit
    // quando suggestUnit ou container-context inferiu um valor melhor)
    const unit = parsed.unit || normalized.unit

    results.push({
      id:                  crypto.randomUUID(),
      ...parsed,
      unit,
      name,
      originalName:        parsed.originalName,
      category:            normalized.category ?? '',
      suggestedCategory:   normalized.category,
      categoryConfident:   normalized.categoryConfident,
      warnings:            normalized.warnings,
      wasManuallyEdited:   false,
      isDuplicate:         existingId !== undefined,
      isDuplicateInBatch:  batchDupIdx !== undefined,
      existingArticleId:   existingId,
      deleted:             false,
    })

    if (batchDupIdx === undefined) {
      seenInBatch.set(key, results.length - 1)
    }
  }

  return results
}

/** Re-avalia isDuplicate e isDuplicateInBatch sem fazer re-parse completo. */
export function recomputeDuplicates(
  lines: ParsedLine[],
  existingArticles: { id: string; name: string }[]
): ParsedLine[] {
  const existingMap = new Map(
    existingArticles.map(a => [normalizeKey(a.name), a.id])
  )
  const seenInBatch = new Map<string, boolean>()

  return lines.map(line => {
    const key = normalizeKey(line.name)
    const existingId = existingMap.get(key)
    const isDuplicateInBatch = seenInBatch.has(key)
    if (!isDuplicateInBatch) seenInBatch.set(key, true)
    return {
      ...line,
      isDuplicate:       existingId !== undefined,
      isDuplicateInBatch,
      existingArticleId: existingId,
    }
  })
}
