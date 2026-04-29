import { normalizeKey } from './ingredientDictionary'
import { buildArticleDraft } from './articleDraft'
import { findExistingMatch } from './resolveArticleAction'
import type { ArticleWarning } from './normalizeArticle'
import type { ConfidenceLevel, ConfidenceReason } from './articleConfidence'

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
  /** Estado da linha: 'ok' (nome+unit prontos) | 'partial' (faltam dados). Mantém-se separado de `confidence`. */
  lineState: 'ok' | 'partial'
  /** Confiança operacional do parser. Drive do dot/contador no BulkImportPanel. */
  confidence:        ConfidenceLevel
  confidenceReasons: ConfidenceReason[]
  needsReview:       boolean
  isDuplicate: boolean
  isDuplicateInBatch: boolean
  existingArticleId?:   string
  /** Nome do artigo existente na DB. Difere de `name` quando isBaseFallback=true
   *  (parser canonicalizou para "X em <container>" mas só "X" existe). UI usa
   *  para mostrar "Variante de {existingArticleName}" sem confundir o chef. */
  existingArticleName?: string
  /** True quando a dedup falhou no match exato e usou o fallback de strip
   *  "em <container>" (CONTAINER_KEEP). Sinaliza que line.name (canónico) e
   *  o artigo existente têm nomes diferentes — UI deve mostrar o existente. */
  isBaseFallback?:      boolean
  deleted: boolean
}

// findExistingMatch e a regra de base fallback vivem em
// `src/lib/resolveArticleAction.ts` — fonte única partilhada entre
// parseProductLines (bulk) e resolveArticleInputAction (manual).

// ── API pública ──────────────────────────────────────────────────────────────

export function parseProductLines(
  rawText: string,
  existingArticles: { id: string; name: string }[] = [],
  orgAliases?: Map<string, string>,
): ParsedLine[] {
  const existingMap = new Map(
    existingArticles.map(a => [normalizeKey(a.name), { id: a.id, name: a.name }]),
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

    // Match: 1º exato pelo canónico do parser; 2º base fallback (strip
    // " em <container_keep>"). seenInBatch usa o key canónico para detectar
    // repetições no batch — se o chef colar "tomate pelado lata 2.5kg" duas
    // vezes, é duplicate do batch independentemente de o exato ou base
    // fallback ter ganho. Não duplicamos "exato vs fallback" como entries
    // diferentes do batch.
    const key         = draft.normalizedKey
    const match       = findExistingMatch(draft.name, existingMap)
    const batchDupIdx = seenInBatch.get(key)

    const stock_unit     = draft.supplierSeed?.order_unit ?? ''
    const base_per_order = draft.supplierSeed?.conversion_factor != null
      ? String(draft.supplierSeed.conversion_factor)
      : ''
    const qty = draft.detected_qty != null ? String(draft.detected_qty) : ''

    const lineState: 'ok' | 'partial' =
      draft.name.length > 0 && draft.unit ? 'ok' : 'partial'

    results.push({
      id:                   crypto.randomUUID(),
      rawLine,
      name:                 draft.name,
      originalName:         draft.originalName,
      qty,
      unit:                 draft.unit,
      stock_unit,
      base_per_order,
      detected_multipack:   draft.detected_multipack,
      par_level:            '0',
      category:             draft.category ?? '',
      suggestedCategory:    draft.category,
      categoryConfident:    draft.categoryConfident,
      warnings:             draft.warnings,
      wasManuallyEdited:    false,
      lineState,
      confidence:           draft.confidence,
      confidenceReasons:    draft.confidenceReasons,
      needsReview:          draft.needsReview,
      isDuplicate:          match !== null,
      isDuplicateInBatch:   batchDupIdx !== undefined,
      existingArticleId:    match?.id,
      existingArticleName:  match?.name,
      isBaseFallback:       match?.isBaseFallback ?? false,
      deleted:              false,
    })

    if (batchDupIdx === undefined) {
      seenInBatch.set(key, results.length - 1)
    }
  }

  return results
}

/** Re-avalia isDuplicate e isDuplicateInBatch sem fazer re-parse completo.
 *  Espelha findExistingMatch para manter paridade com parseProductLines —
 *  edições do nome no preview têm de re-disparar o base fallback. */
export function recomputeDuplicates(
  lines: ParsedLine[],
  existingArticles: { id: string; name: string }[],
): ParsedLine[] {
  const existingMap = new Map(
    existingArticles.map(a => [normalizeKey(a.name), { id: a.id, name: a.name }]),
  )
  const seenInBatch = new Map<string, boolean>()

  return lines.map(line => {
    const key                = normalizeKey(line.name)
    const match              = findExistingMatch(line.name, existingMap)
    const isDuplicateInBatch = seenInBatch.has(key)
    if (!isDuplicateInBatch) seenInBatch.set(key, true)
    return {
      ...line,
      isDuplicate:         match !== null,
      isDuplicateInBatch,
      existingArticleId:   match?.id,
      existingArticleName: match?.name,
      isBaseFallback:      match?.isBaseFallback ?? false,
    }
  })
}
