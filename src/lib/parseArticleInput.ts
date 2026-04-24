const WEIGHT_RE    = /(\d+[.,]?\d*)\s*(kg|g|mg|gr|grs|gramas?)\b/i
const VOLUME_RE    = /(\d+[.,]?\d*)\s*(litros?|mililitros?|lt[s]?|cl|dl|ml|mL|l)\b/i
const PACKAGING_RE = /(\d+[.,]?\d*)\s*(cx|caixas?|sacos?|sacola|packs?|pacotes?|vasos?|fardos?|molhos?|maços?|ramos?|garrafas?|garrafão|latas?|frascos?|bisnaga|tabuleiros?|baldes?|bote|emb|embalagens?)\b/i

// Container words sem número (ex: "frasco" em "Mel frasco")
const CONTAINER_WORDS = new Set([
  'lata', 'latas', 'frasco', 'frascos', 'bisnaga',
  'conserva', 'conservas', 'enlatado', 'enlatada',
  'caixa', 'caixas', 'cx',
  'saco', 'sacos', 'sacola',
  'embalagem', 'embalagens', 'emb',
  'balde', 'baldes',
  'pacote', 'pacotes', 'pack', 'packs',
  'garrafa', 'garrafas', 'garrafão',
  'tabuleiro', 'tabuleiros',
  'vaso', 'vasos',
  'fardo', 'fardos',
  'molho', 'molhos',
  'maço', 'maços',
  'ramo', 'ramos',
  'bote',
])

function parseQty(raw: string): number {
  return parseFloat(raw.replace(',', '.'))
}

function displayUnit(raw: string): string {
  const u = raw.toLowerCase()
  if (['litro', 'litros', 'lt', 'lts'].includes(u)) return 'L'
  if (['mililitro', 'mililitros'].includes(u))        return 'mL'
  if (['grama', 'gramas', 'gr', 'grs'].includes(u))  return 'g'
  if (u === 'mg')                                     return 'mg'
  return raw
}

export interface ParsedArticleInput {
  name: string                   // input sem qty/unit/packaging (sem DICT)
  detected_qty: number | null
  detected_unit: string | null   // "kg", "g", "mL", "L" — legível para humano
  detected_packaging: string | null
}

export function parseArticleInput(raw: string): ParsedArticleInput {
  const trimmed = raw.trim()
  if (!trimmed) return { name: '', detected_qty: null, detected_unit: null, detected_packaging: null }

  let working          = trimmed
  let detected_qty:       number | null = null
  let detected_unit:      string | null = null
  let detected_packaging: string | null = null

  // 1. Peso → qty + unit raw
  const wm = working.match(WEIGHT_RE)
  if (wm) {
    detected_qty  = parseQty(wm[1])
    detected_unit = displayUnit(wm[2])
    working       = working.replace(wm[0], ' ')
  } else {
    // 2. Volume → qty + unit raw
    const vm = working.match(VOLUME_RE)
    if (vm) {
      detected_qty  = parseQty(vm[1])
      detected_unit = displayUnit(vm[2])
      working       = working.replace(vm[0], ' ')
    }
  }

  // 3. Packaging com número (ex: "2 frascos") → packaging
  const pm = working.match(PACKAGING_RE)
  if (pm) {
    detected_packaging = pm[2].toLowerCase()
    working            = working.replace(pm[0], ' ')
  } else {
    // 4. Container word sem número (ex: "frasco" em "Mel frasco")
    const words = working.split(/\s+/).filter(Boolean)
    const idx   = words.findIndex(w => CONTAINER_WORDS.has(w.toLowerCase()))
    if (idx >= 0) {
      detected_packaging = words[idx].toLowerCase()
      words.splice(idx, 1)
      working = words.join(' ')
    }
  }

  const name = working.replace(/\s{2,}/g, ' ').trim()
  return { name, detected_qty, detected_unit, detected_packaging }
}
