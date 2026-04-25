import { normalizeKey } from './ingredientDictionary'
import { buildArticleDraft } from './articleDraft'
import type { ArticleWarning } from './normalizeArticle'

export type ParsedLine = {
  id: string
  rawLine: string
  name: string
  originalName: string      // nome tal como o parser extraiu, antes de edições do utilizador
  qty: string               // qty numérica extraída (referência, não usada na criação)
  unit: string              // base_unit (g, mL, un…)
  stock_unit: string        // unidade de stock (saco, molho…); '' = igual a unit
  base_per_order: string    // base_units por order_unit (para fornecedor); '' = não configurado
  /** Multipack detetado ("6x1L"): preserva count × perPack para hint UX. */
  detected_multipack?: { count: number; perPack: number }
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

// ── API pública ──────────────────────────────────────────────────────────────

export function parseProductLines(
  rawText: string,
  existingArticles: { id: string; name: string }[] = [],
  orgAliases?: Map<string, string>,
): ParsedLine[] {
  const existingMap = new Map(
    existingArticles.map(a => [normalizeKey(a.name), a.id]),
  )

  const seenInBatch = new Map<string, number>()
  const results: ParsedLine[] = []

  for (const rawLine of rawText.split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    // Ignorar linhas que são só números
    if (/^\d+([.,]\d+)?$/.test(trimmed)) continue

    const draft = buildArticleDraft(rawLine, orgAliases)
    if (!draft.name) continue

    const key         = draft.normalizedKey
    const existingId  = existingMap.get(key)
    const batchDupIdx = seenInBatch.get(key)

    const stock_unit     = draft.supplierSeed?.order_unit ?? ''
    const base_per_order = draft.supplierSeed?.conversion_factor != null
      ? String(draft.supplierSeed.conversion_factor)
      : ''
    const qty = draft.detected_qty != null ? String(draft.detected_qty) : ''

    const confidence: 'ok' | 'partial' =
      draft.name.length > 0 && draft.unit ? 'ok' : 'partial'

    results.push({
      id:                  crypto.randomUUID(),
      rawLine,
      name:                draft.name,
      originalName:        draft.originalName,
      qty,
      unit:                draft.unit,
      stock_unit,
      base_per_order,
      detected_multipack:  draft.detected_multipack,
      par_level:           '0',
      category:            draft.category ?? '',
      suggestedCategory:   draft.category,
      categoryConfident:   draft.categoryConfident,
      warnings:            draft.warnings,
      wasManuallyEdited:   false,
      confidence,
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
  existingArticles: { id: string; name: string }[],
): ParsedLine[] {
  const existingMap = new Map(
    existingArticles.map(a => [normalizeKey(a.name), a.id]),
  )
  const seenInBatch = new Map<string, boolean>()

  return lines.map(line => {
    const key                = normalizeKey(line.name)
    const existingId         = existingMap.get(key)
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
