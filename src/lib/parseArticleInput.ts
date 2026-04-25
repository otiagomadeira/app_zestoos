const WEIGHT_RE    = /(\d+[.,]?\d*)\s*(kg|g|mg|gr|grs|gramas?)\b/i
const VOLUME_RE    = /(\d+[.,]?\d*)\s*(litros?|mililitros?|lt[s]?|cl|dl|ml|mL|l)\b/i
const PACKAGING_RE = /(\d+[.,]?\d*)\s*(cx|caixas?|sacos?|sacola|packs?|pacotes?|vasos?|fardos?|molhos?|maços?|ramos?|garrafas?|garrafão|latas?|frascos?|bisnaga|tabuleiros?|baldes?|bote|emb|embalagens?)\b/i

// Variantes → canonical label. Palavras fora deste mapa → null (não guardar lixo).
const PACKAGING_MAP: Record<string, string> = {
  frasco: 'frasco', frascos: 'frasco', 'frasc.': 'frasco',
  cx: 'caixa', caixa: 'caixa', caixas: 'caixa',
  saco: 'saco', sacos: 'saco', sacola: 'saco',
  balde: 'balde', baldes: 'balde',
  garrafa: 'garrafa', garrafas: 'garrafa', garrafão: 'garrafa',
  lata: 'lata', latas: 'lata',
  pacote: 'pacote', pacotes: 'pacote', pack: 'pack', packs: 'pack',
  tabuleiro: 'tabuleiro', tabuleiros: 'tabuleiro',
  fardo: 'fardo', fardos: 'fardo',
  bisnaga: 'bisnaga',
}

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

// Conectores PT que aparecem entre packaging e qty (ex: "frasco de 1KG")
// Removidos quando adjacentes a um label de embalagem stripped.
const CONNECTORS = new Set(['de', 'da', 'do', 'dos', 'das'])

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

  // 3. Packaging com número (ex: "2 frascos") → packaging normalizado
  const pm = working.match(PACKAGING_RE)
  if (pm) {
    detected_packaging = PACKAGING_MAP[pm[2].toLowerCase()] ?? null
    working            = working.replace(pm[0], ' ')
  } else {
    // 4. Container word — strip palavra + conectores adjacentes (ex: "Mel frasco de", "Ovo Caixa")
    const words = working.split(/\s+/).filter(Boolean)
    const idx   = words.findIndex(w => CONTAINER_WORDS.has(w.toLowerCase()))
    if (idx >= 0) {
      detected_packaging = PACKAGING_MAP[words[idx].toLowerCase()] ?? null
      // Estender remoção a conectores adjacentes (ex: "Frasco de" depois do nome)
      let start = idx
      let end   = idx + 1
      while (end < words.length && CONNECTORS.has(words[end].toLowerCase())) end++
      while (start > 0 && CONNECTORS.has(words[start - 1].toLowerCase())) start--
      words.splice(start, end - start)
      working = words.join(' ')
    }
  }

  // 5. Se temos packaging mas ainda sem qty, procurar número avulso adjacente
  //    (ex: "Ovo Caixa 180" → packaging=caixa, qty=180; sem unidade = base_unit count)
  if (detected_packaging && detected_qty == null) {
    const bare = working.match(/(\d+[.,]?\d*)/)
    if (bare) {
      detected_qty = parseQty(bare[1])
      working      = working.replace(bare[0], ' ')
    }
  }

  const name = working.replace(/\s{2,}/g, ' ').trim()
  return { name, detected_qty, detected_unit, detected_packaging }
}
