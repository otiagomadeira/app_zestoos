/**
 * Decisão única partilhada entre o ArticleForm manual e o BulkImportPanel.
 *
 * Dado um input bruto + a lista de artigos existentes, resolve UMA de três
 * acções que a UI deve executar:
 *
 *   - create_article   → não há match na DB; criar artigo novo
 *   - add_size         → match existe + linha tem qty/embalagem útil; adicionar
 *                        article_size em vez de criar artigo
 *   - duplicate_only   → match existe sem info de tamanho; CTA bloqueada,
 *                        chef pode forçar criação como override
 *
 * Sem esta camada, ArticleForm e BulkImportPanel divergiam: o manual mostrava
 * só warning e mantinha "Guardar Artigo" mesmo quando havia tamanho útil. O
 * bulk só aprendeu a decisão correcta no patch anterior. Centralizar elimina
 * a duplicação e garante que ambos os canais respondem da mesma forma a
 * mesmo input.
 *
 * Função pura: não toca em DB, não chama mutações. Os call-sites (UI handlers)
 * é que executam createArticle / createArticleSizeIfMissing conforme a action.
 */

import { buildArticleDraft, type ArticleDraft } from './articleDraft'
import { normalizeKey } from './ingredientDictionary'
import { formatBaseQty } from './units'

// ── Match entre canónico do parser e DB existente ───────────────────────────
// 2 passagens: 1ª match exato; 2ª strip " em (lata|conserva)" e re-match.
// Container set apertado deliberadamente: só os sufixos que aparecem no
// canónico via CONTAINER_KEEP_IN_NAME do normalizeArticle. Outros containers
// (frasco/saco/garrafa) nunca entram no nome — são order_unit puro.
const EM_CONTAINER_SUFFIX_RE = /\s+em\s+(?:lata|latas|conserva|conservas)$/i

export function stripEmContainerSuffix(name: string): string {
  return name.replace(EM_CONTAINER_SUFFIX_RE, '')
}

export function findExistingMatch(
  canonicalName: string,
  existingMap:   Map<string, { id: string; name: string }>,
): { id: string; name: string; isBaseFallback: boolean } | null {
  const exactKey = normalizeKey(canonicalName)
  const exact    = existingMap.get(exactKey)
  if (exact) return { ...exact, isBaseFallback: false }

  const stripped = stripEmContainerSuffix(canonicalName)
  if (stripped !== canonicalName) {
    const baseKey = normalizeKey(stripped)
    const base    = existingMap.get(baseKey)
    if (base) return { ...base, isBaseFallback: true }
  }
  return null
}

// ── Derivação de size a partir de uma ParsedLine-like ───────────────────────
// Aceita o subset de campos que tanto ParsedLine como ArticleDraft podem
// fornecer. ArticleDraft expõe supplierSeed; ParsedLine expõe stock_unit/
// base_per_order/qty já extraídos. Aqui aceitamos a forma normalizada
// (stock_unit/factor/qty) — call-sites convertem o que tiverem.
export type VariantSizeInput = {
  unit:          string
  stock_unit:    string   // '' quando não há label de embalagem detectado
  base_per_order: string  // '' quando não há factor; usar parseFloat
  qty:           string   // detected_qty em base_unit; '' quando ausente
}

/**
 * Regras (espelham a regra de produto):
 *   - stock_unit + factor → label = "{stock_unit} {qty fmt PT}" base = factor
 *     (ex.: "lata 2,5 kg", base 2500 g)
 *   - stock_unit sem factor → label = stock_unit, base = 1
 *     (ex.: "caixa", base 1 — chef refina depois)
 *   - sem stock_unit, qty > 0 → label = "{qty fmt PT}" base = qty
 *     (ex.: "25 kg", base 25000 g)
 *   - resto → null
 *
 * formatBaseQty usa vírgula PT — fica consistente com SeedHint e botão.
 */
export function deriveVariantSize(line: VariantSizeInput): { label: string; basePerUnit: number } | null {
  if (line.unit !== 'g' && line.unit !== 'mL' && line.unit !== 'un') return null
  const baseUnit = line.unit
  const factor   = parseFloat(line.base_per_order)
  const qty      = parseFloat(line.qty)

  if (line.stock_unit && !isNaN(factor) && factor > 0) {
    return { label: `${line.stock_unit} ${formatBaseQty(factor, baseUnit)}`, basePerUnit: factor }
  }
  if (line.stock_unit) {
    return { label: line.stock_unit, basePerUnit: 1 }
  }
  if (!isNaN(qty) && qty > 0) {
    return { label: formatBaseQty(qty, baseUnit), basePerUnit: qty }
  }
  return null
}

// Helper interno: compõe o "ver" de VariantSizeInput a partir de um draft.
// O draft já tem supplierSeed e detected_qty; este wrapper espelha o que
// parseProductLines faz para a ParsedLine, evitando duplicação na call-site.
function variantInputFromDraft(draft: ArticleDraft): VariantSizeInput {
  return {
    unit:           draft.unit,
    stock_unit:     draft.supplierSeed?.order_unit ?? '',
    base_per_order: draft.supplierSeed?.conversion_factor != null
                      ? String(draft.supplierSeed.conversion_factor)
                      : '',
    qty:            draft.detected_qty != null ? String(draft.detected_qty) : '',
  }
}

// ── Action types ────────────────────────────────────────────────────────────

export type ArticleInputAction =
  | {
      kind:   'create_article'
      draft:  ArticleDraft
      reason: 'no-name' | 'no-existing-match'
    }
  | {
      kind:                'add_size'
      draft:               ArticleDraft
      existingArticleId:   string
      existingArticleName: string
      isBaseFallback:      boolean
      sizeLabel:           string
      basePerUnit:         number
      reason:              'exact-match-with-size' | 'base-fallback-with-size'
    }
  | {
      kind:                'duplicate_only'
      draft:               ArticleDraft
      existingArticleId:   string
      existingArticleName: string
      isBaseFallback:      boolean
      reason:              'duplicate-without-size'
    }

// ── API pública ─────────────────────────────────────────────────────────────

export function resolveArticleInputAction(args: {
  input:            string
  existingArticles: { id: string; name: string }[]
  aliases?:         Map<string, string>
}): ArticleInputAction {
  const draft = buildArticleDraft(args.input, args.aliases)

  if (!draft.name) {
    return { kind: 'create_article', draft, reason: 'no-name' }
  }

  const existingMap = new Map(
    args.existingArticles.map(a => [normalizeKey(a.name), { id: a.id, name: a.name }]),
  )
  const match = findExistingMatch(draft.name, existingMap)

  if (!match) {
    return { kind: 'create_article', draft, reason: 'no-existing-match' }
  }

  const size = deriveVariantSize(variantInputFromDraft(draft))

  if (!size) {
    return {
      kind:                'duplicate_only',
      draft,
      existingArticleId:   match.id,
      existingArticleName: match.name,
      isBaseFallback:      match.isBaseFallback,
      reason:              'duplicate-without-size',
    }
  }

  return {
    kind:                'add_size',
    draft,
    existingArticleId:   match.id,
    existingArticleName: match.name,
    isBaseFallback:      match.isBaseFallback,
    sizeLabel:           size.label,
    basePerUnit:         size.basePerUnit,
    reason:              match.isBaseFallback ? 'base-fallback-with-size' : 'exact-match-with-size',
  }
}
