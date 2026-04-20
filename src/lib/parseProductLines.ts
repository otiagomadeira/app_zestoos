import { suggestCategory } from './categoryKeywords'
import { classifyLine, type ClassifiedLine } from './classifyLine'

export type ParsedLine = {
  id: string
  rawLine: string
  name: string
  qty: string          // qty numérica extraída (referência, não usada na criação)
  unit: string         // base_unit (g, mL, un…)
  stock_unit: string   // unidade de stock (saco, molho…); '' = igual a unit
  base_per_order: string // base_units por order_unit (para fornecedor); '' = não configurado
  par_level: string
  category: string
  suggestedCategory: string | null
  confidence: 'ok' | 'partial'
  isDuplicate: boolean
  isDuplicateInBatch: boolean
  existingArticleId?: string
  deleted: boolean
}

/** Normaliza uma chave de nome para comparação: minúsculas + sem acentos */
function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Normaliza capitalização: primeira letra maiúscula, resto minúsculas por palavra */
function toTitleCase(s: string): string {
  return s
    .trim()
    .replace(/\S+/g, w => w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)
}

/** Remove pontuação de fim e espaços extra do nome do artigo */
function cleanName(s: string): string {
  return s.replace(/[.,;:!?]+$/, '').trim()
}

// ── Extracção do nome ────────────────────────────────────────────────────────

// Regex de peso/volume reutilizados aqui apenas para localização posicional
const WEIGHT_RE_POS  = /(\d+[.,]?\d*)\s*(kg|g|mg|gr|grs|gramas?)\b/i
const VOLUME_RE_POS  = /(\d+[.,]?\d*)\s*(litros?|mililitros?|lt[s]?|cl|dl|ml|mL|l)\b/i
const PACKAGING_RE_POS = /(\d+[.,]?\d*)\s*(cx|caixas?|sacos?|sacola|packs?|pacotes?|vasos?|fardos?|molhos?|maços?|ramos?|garrafas?|garrafão|latas?|frascos?|bisnaga|tabuleiros?|baldes?|bote|emb|embalagens?)\b/i
const BARE_NUMBER_RE = /^(\d+[.,]?\d*)\s+/

/**
 * Extrai o nome do artigo de uma linha bruta, dado o resultado do classificador.
 *
 * Estratégia:
 * - weight/volume: remover o match de qty+unit; se houver label adjacente, removê-lo também
 * - packaging: remover o match de qty+label (início ou fim)
 * - unit com qty>0: remover o número do início
 * - error/fallback: devolver a linha completa (o UI mostrará como partial)
 */
function extractName(line: string, cl: ClassifiedLine): string {
  if (cl.type === 'weight' || cl.type === 'volume') {
    const re    = cl.type === 'weight' ? WEIGHT_RE_POS : VOLUME_RE_POS
    const match = line.match(re)
    if (!match || match.index === undefined) return line

    const before = line.slice(0, match.index).trim()
    const after  = line.slice(match.index + match[0].length).trim()

    if (cl.label) {
      // Remover o label de embalagem da parte 'before'
      // Ex: "Rúcula saco 200gr" → before="Rúcula saco" → remover "saco" → "Rúcula"
      const beforeWords = before.split(/\s+/).filter(Boolean)
      const labelIdx    = beforeWords.map(w => w.toLowerCase()).lastIndexOf(cl.label!)
      if (labelIdx >= 0) beforeWords.splice(labelIdx, 1)
      return beforeWords.join(' ') || after || line
    }

    return before || after || line
  }

  if (cl.type === 'packaging') {
    // Remover "qty+label" do início ou do fim
    // Ex: "4cx mozzarella" → "mozzarella" | "iogurte 4 pack" → "iogurte"
    const match = line.match(PACKAGING_RE_POS)
    if (!match || match.index === undefined) return line

    const before = line.slice(0, match.index).trim()
    const after  = line.slice(match.index + match[0].length).trim()
    return before || after || line
  }

  if (cl.type === 'unit' && cl.qty > 0) {
    // Número avulso no início: "4 leite" → "leite"
    return line.replace(BARE_NUMBER_RE, '').trim() || line
  }

  // error ou sem número → devolver linha tal como está
  return line
}

// ── Parser de linha única ────────────────────────────────────────────────────

function parseSingleLine(
  raw: string,
): Omit<ParsedLine, 'id' | 'isDuplicate' | 'isDuplicateInBatch' | 'existingArticleId' | 'deleted' | 'suggestedCategory'> | null {
  const line = raw.trim()
  if (!line) return null

  // Ignorar linhas que são só números
  if (/^\d+([.,]\d+)?$/.test(line)) return null

  // ── Passo 1: Classificar ──────────────────────────────────────────────────
  const cl = classifyLine(line)

  // ── Passo 2: Extrair nome ─────────────────────────────────────────────────
  const rawName = extractName(line, cl)
  const name    = cleanName(toTitleCase(rawName))
  if (!name) return null

  // ── Passo 3: Error → partial (UI bloqueia criação) ────────────────────────
  if (cl.type === 'error') {
    return {
      rawLine:        raw,
      name,
      qty:            '',
      unit:           '',
      stock_unit:     '',
      base_per_order: '',
      par_level:      '0',
      category:       '',
      confidence:     'partial',
    }
  }

  // ── Passo 4: Mapear classificação → campos de ParsedLine ──────────────────
  const unit = cl.base_unit          // 'g' | 'mL' | 'un'
  const qty  = cl.qty > 0 ? String(cl.qty) : ''

  let stock_unit    = ''
  let base_per_order = ''

  if (cl.type === 'packaging') {
    // Sabemos a embalagem (order_unit) mas não o conteúdo por unidade
    stock_unit    = cl.label ?? ''
    base_per_order = ''   // requires_configuration=true → preenchido posteriormente
  } else if ((cl.type === 'weight' || cl.type === 'volume') && cl.label) {
    // Ex: "Rúcula saco 200gr" → stock_unit='saco', base_per_order='200'
    stock_unit    = cl.label
    base_per_order = qty
  }

  const confidence = name.length > 0 && cl.normalized ? 'ok' : 'partial'

  return {
    rawLine: raw,
    name,
    qty,
    unit,
    stock_unit,
    base_per_order,
    par_level:  '0',
    category:   '',
    confidence,
  }
}

// ── API pública ──────────────────────────────────────────────────────────────

export function parseProductLines(
  rawText: string,
  existingArticles: { id: string; name: string }[] = []
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

    const key         = normalizeKey(parsed.name)
    const existingId  = existingMap.get(key)
    const batchDupIdx = seenInBatch.get(key)

    const suggestedCategory = suggestCategory(parsed.name, parsed.unit)
    results.push({
      id:                  crypto.randomUUID(),
      ...parsed,
      category:            suggestedCategory ?? '',
      suggestedCategory,
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

