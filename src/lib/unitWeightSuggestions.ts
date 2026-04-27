// Sugestão de peso médio por unidade (gramas) para artigos contáveis comuns.
//
// USO: getSuggestedUnitWeight('Maçã Royal Gala') → 170. Devolve null quando
// não há match confiável.
//
// REGRA OFICIAL — TODOS OS PESOS SÃO BRUTOS:
//   Produto cru/inteiro, como chega à cozinha, com casca/pele/caroço quando
//   aplicável, antes de limpar/aparar/descascar/cozinhar.
//   Exemplos:
//     • maçã   = inteira com casca
//     • batata = crua com casca
//     • cebola = inteira com casca
//     • abacate = inteiro com casca e caroço
//     • alface = cabeça inteira
//     • pimento = inteiro
//     • cogumelo = inteiro
//     • ovo    = ovo inteiro com casca
//   Esta regra é load-bearing: é o que distingue uma "média operacional"
//   pertinente de um número arbitrário. Se algum dia precisarmos de peso
//   limpo/aparado, isso é OUTRO domínio (yield/rendimento) e vive noutro
//   helper, nunca aqui.
//
// SEMÂNTICA: é uma sugestão operacional, não uma verdade absoluta. Variedade
// e tamanho mudam o peso real (maçã pequena 80g vs golden 250g). NUNCA usar
// para forçar stock ou encomendas — serve apenas para conversões de fichas
// técnicas quando uma receita usa gramas de um artigo contado à unidade
// (ex.: receita "150g de ovo", artigo unit='un', g_per_unit=52).
//
// CONHECIMENTO GLOBAL (vive em código, não em DB) — a separação é regra de
// produto. Aprendizagem por restaurante (idiossincrática) é noutra camada.
//
// MATCHING (por ordem):
//   1. Exact match contra chave normalizada (lowercase + accent-strip).
//   2. Exact match após de-pluralização simples (token >=4 chars, termina
//      em "-s" → remove). Apanha "Pimentos Padrón" → "pimento padron" → 12.
//   3. Fallback por token, mas só para tokens whitelisted abaixo. Defensivo:
//      'cebola' permite "Cebola Doce" → 180, mas 'batata'/'cogumelo' NÃO
//      estão, evitando "Batata Doce", "Cogumelo Laminado", "Tomate Cherry"
//      e "Ovo de Codorniz" como falsos positivos.

import { normalizeKey } from './ingredientDictionary'

const WEIGHTS: Record<string, number> = {
  // Ovos
  'ovo':                52,

  // Alfaces
  'alface iceberg':     500,
  'alface romana':      350,

  // Citrinos e frutas
  'lima':               70,
  'limao':              100,
  'laranja':            220,
  'abacate':            200,

  // Maçãs (variedades comuns em PT)
  'maca':               180,
  'maca royal gala':    170,
  'maca golden':        180,
  'maca fuji':          200,
  'maca granny smith':  180,
  'maca reineta':       220,
  'maca starking':      190,

  // Pêras
  'pera':               160,
  'pera rocha':         140,
  'pera conference':    180,
  'pera abate':         220,
  'pera williams':      170,

  // Cogumelos
  'cogumelo':           15,
  'cogumelo paris':     15,
  'cogumelo branco':    15,
  'cogumelo castanho':  18,
  'cogumelo marron':    18,
  'cogumelo portobello': 80,
  'shiitake':           20,
  'shitake':            20,   // typo comum em PT — mesmo cogumelo.
  'pleurotus':          35,
  'cogumelo eryngii':   80,

  // Cebolas
  'cebola':             180,
  'cebola roxa':        180,

  // Batatas (variedades + batata-doce; batata-doce é vegetal distinto mas
  // é como o chef se refere e devolve peso operacional realista)
  'batata':             200,
  'batata branca':      200,
  'batata vermelha':    180,
  'batata nova':        80,
  'batata miuda':       60,
  'batata doce':        300,
  'batata agria':       220,
  'batata monalisa':    200,

  // Tomates e legumes contáveis
  'tomate':             150,
  'pepino':             300,
  'courgette':          250,
  'cenoura':            100,

  // Pimentos (incluindo padrón com plural defensivo "de padron")
  'pimento':            180,
  'pimento vermelho':   180,
  'pimento verde':      160,
  'pimento amarelo':    180,
  'pimento laranja':    180,
  'pimento padron':     12,
  'pimento de padron':  12,
  'malagueta':          8,
}

// Tokens autorizados a fazer fallback por palavra. Whitelist em vez de
// blacklist: explicit > implicit. Adicionar uma chave aqui é uma decisão
// editorial — significa "esta palavra sozinha indica este artigo de forma
// confiável, mesmo combinada com adjectivos não previstos".
//
// DELIBERADAMENTE FORA: 'batata', 'cogumelo', 'tomate', 'ovo', 'alface',
// 'shiitake', 'malagueta'. Razão: "batata doce" tem 300 (não 200), "tomate
// cherry" deve dar null, "ovo de codorniz" não é ovo de galinha, etc.
const FALLBACK_TOKENS: ReadonlySet<string> = new Set([
  'maca',
  'limao',
  'lima',
  'laranja',
  'abacate',
  'cebola',
  'cenoura',
  'pepino',
  'courgette',
  'pimento',
  'pera',
])

// De-pluralização heurística PT: remove '-s' final em palavras com 4+ chars.
// Aplicada token-a-token. Conservadora — termos singulares acabados em '-s'
// (lápis, ananás) são falsamente despluralizados, mas não causam regressão
// porque a forma resultante simplesmente não bate em WEIGHTS (devolve null).
function depluralize(key: string): string {
  return key
    .split(/\s+/)
    .map(t => (t.length >= 4 && t.endsWith('s')) ? t.slice(0, -1) : t)
    .join(' ')
}

export function getSuggestedUnitWeight(
  name:       string,
  _category?: string | null,
): number | null {
  if (!name || !name.trim()) return null
  const key = normalizeKey(name)
  if (!key) return null

  // 1) Exact em chave original
  if (WEIGHTS[key] != null) return WEIGHTS[key]

  // 2) Exact em chave de-pluralizada (apanha "pimentos padrón" → "pimento padron")
  const deplural = depluralize(key)
  if (deplural !== key && WEIGHTS[deplural] != null) return WEIGHTS[deplural]

  // 3) Token fallback (whitelist) sobre a chave de-pluralizada
  for (const token of deplural.split(/\s+/)) {
    if (FALLBACK_TOKENS.has(token) && WEIGHTS[token] != null) {
      return WEIGHTS[token]
    }
  }

  return null
}
