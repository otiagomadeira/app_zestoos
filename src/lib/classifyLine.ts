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
   *
   * `innerLabel` aparece quando há packaging aninhado: "pacote 1L caixa 6L"
   * → label='caixa' (outer, é o que o chef encomenda), innerLabel='pacote'
   * (alternativa que substitui o "unidade" genérico nas pills).
   */
  multipack?: { count: number; perPack: number; innerLabel?: string }
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
 *
 * Lookbehind `(?<![\dx×])` rejeita match no meio de um número ou de uma
 * dimensão "AxB" — ex.: "20x30 caixa" não pode virar "30 caixa" nem "0 caixa".
 * É 1 char, fixed-length, suportado em todos os browsers-alvo do app.
 */
const PACKAGING_RE = /(?<![\dx×])(\d+[.,]?\d*)\s*(cx|caixas?|sacos?|sacola|packs?|pacotes?|vasos?|fardos?|molhos?|maços?|ramos?|garrafas?|garrafão|latas?|frascos?|bisnaga|tabuleiros?|baldes?|bote|emb|embalagens?|conservas?|enlatad[oa]s?|blocos?)\b/i

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
  'bloco', 'blocos',
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
 *
 * Também detecta multipack-equivalente quando entre o label e a qty existe
 * "<N> <uni-suffix>" — ex.: "Leite pack 6 uni 1lt".
 *   words = [leite, pack, 6, uni]
 *   skip uni-suffix + bare number → land on "pack"
 *   devolve { label: 'pack', multipackCount: 6 }
 *
 * Só promove a multipack quando count > 1 (evita "pack 1 uni 1L" silenciosamente).
 */
const LABEL_CONNECTORS = new Set(['de', 'da', 'do', 'dos', 'das'])

const UNI_SUFFIX_RE = /^(?:uni|unis|unid|unids|unidades?|un)$/i

export type AdjacentLabelMatch = {
  label:           string
  multipackCount?: number
}

function findAdjacentPackagingLabel(line: string, matchIndex: number): AdjacentLabelMatch | null {
  const before = line.slice(0, matchIndex).trim()
  if (!before) return null
  const words = before.split(/\s+/)
  // Salta conectores PT (de, da, do…) para encontrar o label real antes
  let i = words.length - 1
  while (i >= 0 && LABEL_CONNECTORS.has(words[i].toLowerCase())) i--

  // Multipack-equivalente: "<count> <uni-suffix>" entre label e qty.
  // Conservador: só salta quando count > 1 (count=1 é ambíguo, deixa cair).
  let multipackCount: number | undefined
  if (i >= 1 && UNI_SUFFIX_RE.test(words[i]) && /^\d+$/.test(words[i - 1])) {
    const c = parseInt(words[i - 1], 10)
    if (c > 1) {
      multipackCount = c
      i -= 2
      while (i >= 0 && LABEL_CONNECTORS.has(words[i].toLowerCase())) i--
    }
  }

  const target = words[i]?.toLowerCase() ?? ''
  if (!PACKAGING_LABELS.has(target)) return null
  return multipackCount ? { label: target, multipackCount } : { label: target }
}

/**
 * Análogo a findAdjacentPackagingLabel mas olha DEPOIS do match.
 * Cobre o padrão "1lt caixa …" — peso/volume primeiro, label a seguir.
 */
function findAdjacentPackagingLabelAfter(line: string, matchEnd: number): string | null {
  const after = line.slice(matchEnd).trim()
  if (!after) return null
  const words = after.split(/\s+/)
  let i = 0
  while (i < words.length && LABEL_CONNECTORS.has(words[i].toLowerCase())) i++
  const target = words[i]?.toLowerCase() ?? ''
  return PACKAGING_LABELS.has(target) ? target : null
}

/**
 * Detecta o "count" de um multipack-equivalente quando peso/volume vem antes
 * de um label de embalagem. Aplica-se no INÍCIO do `afterLabel` (já limpo
 * de connectors e do próprio label), o que ancora a contagem ao sítio certo
 * — evitar match em números soltos no resto da linha.
 *
 * Aceita formas que o chef escreve naturalmente:
 *   "6 uni"  → 6
 *   "6uni"   → 6     (sem espaço — bug histórico que causava perda do count)
 *   "6 unid" → 6
 *   "6un"    → 6
 *   "4"      → 4     (sem suffix — "pack 4" é multipack de 4 packs)
 *
 * Casos cobertos pelos testes do parser ("leite 1L pack 6uni",
 * "manteiga 200g pack 4", "1lt caixa 6 uni leite m.g.").
 */
const ALT_MULTIPACK_COUNT_RE = /^(\d+)\s*(?:uni|unis|unid|unids|unidades?|un)?\b/i

/**
 * Constrói a ClassifiedLine para weight/volume, escolhendo label adjacente
 * antes ou depois e detectando multipack-equivalente quando há os 3 sinais
 * (qty+unit, label-after, "<N> uni" no resto).
 */
// Regex factory: total na mesma família do match. Reutilizado para detectar
// "X kg/L/g/mL" depois de um label-after (multipack-equivalent ou outer
// packaging em nested).
function sameFamilyTotalRe(type: 'weight' | 'volume'): RegExp {
  return type === 'weight'
    ? /^(\d+[.,]?\d*)\s*(kg|g|mg|gr|grs|gramas?)\b/i
    : /^(\d+[.,]?\d*)\s*(litros?|mililitros?|lt[s]?|cl|dl|ml|l)\b/i
}

function parseSameFamilyTotal(
  text: string,
  type: 'weight' | 'volume',
): number | null {
  const m = text.match(sameFamilyTotalRe(type))
  if (!m) return null
  const raw  = parseQty(m[1])
  const unit = m[2].toLowerCase()
  if (type === 'weight') {
    if (unit === 'kg') return raw * 1000
    return raw
  }
  if (['l', 'lt', 'lts', 'litro', 'litros'].includes(unit)) return raw * 1000
  if (unit === 'cl') return raw * 10
  if (unit === 'dl') return raw * 100
  return raw
}

function resolveQtyMatch(
  line:        string,
  matchIndex:  number,
  matchLength: number,
  type:        'weight' | 'volume',
  baseUnit:    'g' | 'mL',
  qty:         number,
): ClassifiedLine {
  const labelMatch = findAdjacentPackagingLabel(line, matchIndex)
  let label    = labelMatch?.label ?? null
  let total    = qty
  let multipack: { count: number; perPack: number; innerLabel?: string } | undefined

  if (labelMatch?.multipackCount) {
    // Label-before com count "uni" entre label e qty:
    // "leite pack 6 uni 1lt" → label='pack', count=6, perPack=qty.
    // Caminho fechado: não tenta nested-outer porque já temos sinal completo.
    multipack = { count: labelMatch.multipackCount, perPack: qty }
    total     = labelMatch.multipackCount * qty
  } else if (!label) {
    const labelAfter = findAdjacentPackagingLabelAfter(line, matchIndex + matchLength)
    if (labelAfter) {
      label = labelAfter
      // Construir o resto da linha começando imediatamente depois do label,
      // sem espaços/connectors residuais. O trim inicial é essencial: sem ele,
      // o `replace(^${labelAfter})` falhava porque a string começava com " "
      // — causa raiz histórica do "6uni" colado nunca contar como multipack.
      const afterLabel = line
        .slice(matchIndex + matchLength)
        .replace(/^\s+/, '')
        .replace(/^(?:de|da|do|dos|das)\s+/i, '')
        .replace(new RegExp(`^${labelAfter}\\b`, 'i'), '')
        .replace(/^\s+/, '')
      const altMatch = afterLabel.match(ALT_MULTIPACK_COUNT_RE)
      if (altMatch) {
        const count = parseFloat(altMatch[1])
        if (count > 0) {
          multipack = { count, perPack: qty }
          total     = count * qty
        }
      } else {
        // Sem count "uni" no afterLabel — tentar interpretar como TOTAL na
        // mesma família (peso ou volume). Caso típico: "leite 1L pack 6L"
        // → "6L" é o total do pack. Calcula count = total/per-unit; se
        // inteiro > 1, regista multipack. Senão, mantém só o total
        // (conversion_factor passa a ser o total, não a per-unit).
        const totalBase = parseSameFamilyTotal(afterLabel, type)
        if (totalBase != null && totalBase > qty && qty > 0) {
          total = totalBase
          const ratio = totalBase / qty
          if (Number.isInteger(ratio) && ratio > 1) {
            multipack = { count: ratio, perPack: qty }
          }
        }
      }
    }
  } else {
    // Label foi capturado ANTES do qty (ex: "pacote 1l"). Tentar agora detectar
    // packaging exterior aninhado: "pacote 1l caixa 6l" → outer='caixa',
    // inner='pacote', total=6L, multipack={6, 1000, innerLabel:'pacote'}.
    // O label final passa a ser o outer (é o que o chef encomenda).
    const outerLabel = findAdjacentPackagingLabelAfter(line, matchIndex + matchLength)
    if (outerLabel && outerLabel !== label) {
      const afterOuter = line
        .slice(matchIndex + matchLength)
        .replace(/^\s+/, '')
        .replace(/^(?:de|da|do|dos|das)\s+/i, '')
        .replace(new RegExp(`^${outerLabel}\\b`, 'i'), '')
        .replace(/^\s+/, '')
      const totalBase = parseSameFamilyTotal(afterOuter, type)
      if (totalBase != null && totalBase > qty && qty > 0) {
        const ratio = totalBase / qty
        if (Number.isInteger(ratio) && ratio > 1) {
          multipack = { count: ratio, perPack: qty, innerLabel: label }
          label     = outerLabel
          total     = totalBase
        }
      }
    }
  }

  return {
    type,
    base_unit: baseUnit,
    qty: total,
    label,
    normalized: true,
    requires_configuration: false,
    ...(multipack ? { multipack } : {}),
  }
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
  // Guard count > 1: "1x6lt" não é multipack — é volume simples 6L. Sem este
  // guard, o sistema inventava {count:1, perPack:6L}, dando false positive
  // silencioso ao chef.
  const multipackMatch = line.match(MULTIPACK_RE)
  if (multipackMatch && multipackMatch.index !== undefined && parseFloat(multipackMatch[1]) > 1) {
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
    // Branch MULTIPACK_RE já tem o count vindo da regex (Nx...). Aqui só nos
    // interessa o label simples — descartamos qualquer multipackCount derivado
    // de findAdjacentPackagingLabel para não duplicar.
    const label = findAdjacentPackagingLabel(line, multipackMatch.index)?.label ?? null

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

    return resolveQtyMatch(line, weightMatch.index, weightMatch[0].length, 'weight', 'g', qty)
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

    return resolveQtyMatch(line, volumeMatch.index, volumeMatch[0].length, 'volume', 'mL', qty)
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
