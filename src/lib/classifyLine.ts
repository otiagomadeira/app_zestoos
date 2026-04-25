// ============================================================
// ZESTO OS — Motor de Classificação de Linhas
//
// classifyLine(raw) corre ANTES de qualquer lógica de variantes,
// deduplicação ou preview. É um classificador puro: não cria dados,
// não decide se o produto pode ser salvo.
//
// Ordem de prioridade obrigatória:
//   1. Ambiguidade → error
//   2. Peso   (kg, g, mg, gr…)         → weight,   base_unit:'g'
//   3. Volume (L, ml, lt, cl, dl…)     → volume,   base_unit:'mL'
//   4. Embalagem (cx, saco, pack…)     → packaging, base_unit:'un'
//   5. Número avulso                   → unit,      base_unit:'un'
//   6. Sem número                      → unit,      base_unit:'un', normalized:false
// ============================================================

export type ClassifiedLine = {
  /** Categoria semântica da linha */
  type: 'weight' | 'volume' | 'packaging' | 'unit' | 'error'
  /** Unidade base normalizada */
  base_unit: 'g' | 'mL' | 'un'
  /** Quantidade normalizada em base_unit (kg→g ×1000, L→mL ×1000, etc.) */
  qty: number
  /** Label de embalagem extraído: 'cx', 'saco', etc. Null se não aplicável */
  label: string | null
  /** false se qty=0 ou a linha não contém um número reconhecível */
  normalized: boolean
  /**
   * true = a cadeia de conversão está incompleta e precisa de input do utilizador
   * antes de o artigo poder ser totalmente configurado.
   *
   * weight/volume → false (chain completa a partir do valor explícito)
   * packaging     → true  (sabemos order_unit mas não base_per_order_unit)
   * unit          → true  (base_unit=un mas order_unit e stock_unit desconhecidos)
   * error         → false (bloqueado de outra forma)
   */
  requires_configuration: boolean
  /**
   * Preserva count × perPack (em base_unit) quando o input é multipack ("6x1L").
   * Existe para UX (hint reconhecível pelo chef); qty já contém o total.
   */
  multipack?: { count: number; perPack: number }
}

export type MissingField = 'base_per_order_unit' | 'order_unit' | 'base_unit_confirmation'

export type NeedsUserInputResult = {
  needed: boolean
  missing: MissingField[]
  /** Perguntas em PT a apresentar ao utilizador */
  questions: string[]
}

// ── Constantes internas ──────────────────────────────────────────────────────

/** Palavras que tornam a linha ambígua → bloquear criação automática */
const AMBIGUITY_RE = /\bcada\b|\bpor\s+unidade\b|\bpor\s+peça\b/i

/**
 * Peso: kg, g, mg, gr, grs, gramas, grama
 * Grupos: (1) número  (2) unidade
 */
const WEIGHT_RE = /(\d+[.,]?\d*)\s*(kg|g|mg|gr|grs|gramas?)\b/i

/**
 * Volume: l, lt, lts, litro, litros, ml, mililitros, cl, dl
 * Grupos: (1) número  (2) unidade
 * Nota: "l" só no fim de palavra (\b) para não capturar "ml" no match de "l"
 */
const VOLUME_RE = /(\d+[.,]?\d*)\s*(litros?|mililitros?|lt[s]?|cl|dl|ml|mL|l)\b/i

/**
 * Embalagem como prefixo de número: "4cx", "3 saco", "2 pack", etc.
 * Grupos: (1) número  (2) label de embalagem
 * Apenas activo quando peso/volume NÃO foram detectados primeiro.
 */
const PACKAGING_RE = /(\d+[.,]?\d*)\s*(cx|caixas?|sacos?|sacola|packs?|pacotes?|vasos?|fardos?|molhos?|maços?|ramos?|garrafas?|garrafão|latas?|frascos?|bisnaga|tabuleiros?|baldes?|bote|emb|embalagens?|conservas?|enlatad[oa]s?)\b/i

/**
 * Multipack: "6x1L", "12x500g", "cx 6x1L", "caixa 12x500g"
 * Grupos: (1) count  (2) per-pack qty  (3) per-pack unit
 * Avaliado ANTES de WEIGHT/VOLUME para que o total seja count × per-pack.
 */
const MULTIPACK_RE = /(\d+)\s*[x×]\s*(\d+[.,]?\d*)\s*(kg|g|mg|gr|grs|gramas?|litros?|mililitros?|lt[s]?|cl|dl|ml|mL|l)\b/i

/** Número avulso no início da linha (sem unidade reconhecida a seguir) */
const BARE_NUMBER_RE = /^(\d+[.,]?\d*)\s+\S/

/**
 * Set de labels de embalagem — usado para detetar uma packaging word
 * imediatamente antes de um match de peso/volume.
 * Ex: "Rúcula saco 200gr" → "saco" está antes de "200gr" → label='saco'
 */
const PACKAGING_LABELS = new Set([
  'cx', 'caixa', 'caixas',
  'saco', 'sacola', 'sacos',
  'pack', 'pacote', 'pacotes',
  'vaso', 'vasos',
  'fardo', 'fardos',
  'molho', 'molhos',
  'maço', 'maços',
  'ramo', 'ramos',
  'garrafa', 'garrafas', 'garrafão',
  'lata', 'latas',
  'frasco', 'frascos',
  'bisnaga',
  'tabuleiro', 'tabuleiros',
  'balde', 'baldes',
  'bote',
  'emb', 'embalagem', 'embalagens',
  // 'conserva' fica como tipo de produto (mantida no nome via CONTAINER_KEEP_IN_NAME);
  // 'enlatado' canonicaliza para 'lata' em PACKAGING_MAP (articleDraft.ts).
  'conserva', 'conservas',
  'enlatado', 'enlatada', 'enlatados', 'enlatadas',
])

// ── Utilitário interno ───────────────────────────────────────────────────────

function parseQty(raw: string): number {
  return parseFloat(raw.replace(',', '.'))
}

/**
 * Dado o texto completo e a posição de início de um match de peso/volume,
 * devolve o label de embalagem imediatamente antes (se existir).
 * Ex: "Rúcula saco 200gr" com matchIndex=8 → 'saco'
 *      "Mel frasco de 1KG"               → 'frasco' (skip do conector "de")
 */
const LABEL_CONNECTORS = new Set(['de', 'da', 'do', 'dos', 'das'])

function findAdjacentPackagingLabel(line: string, matchIndex: number): string | null {
  const before = line.slice(0, matchIndex).trim()
  if (!before) return null
  const words = before.split(/\s+/)
  // Salta conectores PT (de, da, do…) para encontrar o label real antes
  let i = words.length - 1
  while (i >= 0 && LABEL_CONNECTORS.has(words[i].toLowerCase())) i--
  const target = words[i]?.toLowerCase() ?? ''
  return PACKAGING_LABELS.has(target) ? target : null
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Classifica uma linha de texto bruta.
 * Deve ser chamado ANTES de qualquer lógica de variantes, deduplicação ou preview.
 * Nunca inventa dados — se algo for ambíguo, devolve type:'error'.
 */
export function classifyLine(raw: string): ClassifiedLine {
  const line = raw.trim()

  // ── 1. Ambiguidade → bloquear ──────────────────────────────────────────────
  if (AMBIGUITY_RE.test(line)) {
    return { type: 'error', base_unit: 'g', qty: 0, label: null, normalized: false, requires_configuration: false }
  }

  // ── 1.5 Multipack (count × per-pack) ──────────────────────────────────────
  const multipackMatch = line.match(MULTIPACK_RE)
  if (multipackMatch && multipackMatch.index !== undefined) {
    const count   = parseFloat(multipackMatch[1])
    const each    = parseQty(multipackMatch[2])
    const rawUnit = multipackMatch[3].toLowerCase()

    let baseUnit: 'g' | 'mL'
    let perPack:  number

    if (rawUnit === 'kg') {
      baseUnit = 'g'
      perPack  = each * 1000
    } else if (['g', 'mg', 'gr', 'grs', 'gramas', 'grama'].includes(rawUnit)) {
      baseUnit = 'g'
      perPack  = each
    } else if (['l', 'lt', 'lts', 'litro', 'litros'].includes(rawUnit)) {
      baseUnit = 'mL'
      perPack  = each * 1000
    } else if (rawUnit === 'cl') {
      baseUnit = 'mL'
      perPack  = each * 10
    } else if (rawUnit === 'dl') {
      baseUnit = 'mL'
      perPack  = each * 100
    } else {
      baseUnit = 'mL'
      perPack  = each   // ml | mililitros
    }

    const total = count * perPack
    const label = findAdjacentPackagingLabel(line, multipackMatch.index)

    return {
      type: baseUnit === 'g' ? 'weight' : 'volume',
      base_unit: baseUnit,
      qty: total,
      label,
      normalized: true,
      requires_configuration: false,
      multipack: { count, perPack },
    }
  }

  // ── 2. Peso ────────────────────────────────────────────────────────────────
  const weightMatch = line.match(WEIGHT_RE)
  if (weightMatch && weightMatch.index !== undefined) {
    const rawQty  = parseQty(weightMatch[1])
    const rawUnit = weightMatch[2].toLowerCase()
    const qty     = rawUnit === 'kg' ? rawQty * 1000 : rawQty
    const label   = findAdjacentPackagingLabel(line, weightMatch.index)

    return { type: 'weight', base_unit: 'g', qty, label, normalized: true, requires_configuration: false }
  }

  // ── 3. Volume ──────────────────────────────────────────────────────────────
  const volumeMatch = line.match(VOLUME_RE)
  if (volumeMatch && volumeMatch.index !== undefined) {
    const rawQty  = parseQty(volumeMatch[1])
    const rawUnit = volumeMatch[2].toLowerCase()

    let qty = rawQty
    if (['l', 'lt', 'lts', 'litro', 'litros'].includes(rawUnit)) qty = rawQty * 1000
    else if (rawUnit === 'cl') qty = rawQty * 10
    else if (rawUnit === 'dl') qty = rawQty * 100
    // ml / mililitros → direto

    const label = findAdjacentPackagingLabel(line, volumeMatch.index)

    return { type: 'volume', base_unit: 'mL', qty, label, normalized: true, requires_configuration: false }
  }

  // ── 4. Embalagem como prefixo numérico ────────────────────────────────────
  const packagingMatch = line.match(PACKAGING_RE)
  if (packagingMatch) {
    const qty   = parseQty(packagingMatch[1])
    const label = packagingMatch[2].toLowerCase()

    return { type: 'packaging', base_unit: 'un', qty, label, normalized: true, requires_configuration: true }
  }

  // ── 5. Número avulso → assumir 'un' ───────────────────────────────────────
  const bareMatch = line.match(BARE_NUMBER_RE)
  if (bareMatch) {
    const qty = parseQty(bareMatch[1])

    return { type: 'unit', base_unit: 'un', qty, label: null, normalized: true, requires_configuration: true }
  }

  // ── 6. Sem número reconhecível ────────────────────────────────────────────
  return { type: 'unit', base_unit: 'un', qty: 0, label: null, normalized: false, requires_configuration: true }
}

/**
 * Determina se uma linha classificada precisa de input adicional do utilizador
 * para que a cadeia de conversão possa ser completada.
 * Deve ser chamado após classifyLine — nunca substitui a classificação.
 */
export function needsUserInput(cl: ClassifiedLine): NeedsUserInputResult {
  if (cl.type === 'error') {
    return { needed: false, missing: [], questions: [] }
  }

  if (cl.type === 'packaging') {
    return {
      needed: true,
      missing: ['base_per_order_unit'],
      questions: [`Quantas unidades por ${cl.label ?? 'embalagem'}?`],
    }
  }

  if (cl.type === 'unit') {
    if (!cl.normalized) {
      // Linha sem número nenhum — precisamos de confirmar base_unit e order_unit
      return {
        needed: true,
        missing: ['base_unit_confirmation', 'order_unit'],
        questions: [
          'Qual é a unidade base deste artigo? (g, mL, un)',
          'Qual é a unidade de encomenda?',
        ],
      }
    }
    // Número avulso — sabemos qty mas não o contexto de encomenda
    return {
      needed: true,
      missing: ['order_unit'],
      questions: ['Qual é a unidade de encomenda deste artigo?'],
    }
  }

  // weight / volume — cadeia completa (base_unit e qty conhecidos)
  return { needed: false, missing: [], questions: [] }
}
