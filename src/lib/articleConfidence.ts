/**
 * Camada de confiança operacional do parser.
 *
 * Não é um score. São 3 níveis fixos + lista frozen de 6 reasons. O objectivo
 * é evitar falsa confiança em inputs caóticos (OCR, embalagens, descartáveis,
 * códigos): o chef sabe quando perguntar em vez de guardar lixo silencioso.
 *
 * Pure. Sem persistência. Não toca em DB. Não infere — só reage a evidências.
 *
 *   HIGH   → nome limpo, intenção clara, sem sinais de perda → não mostrar nada
 *   MEDIUM → 1 sinal não-crítico (categoria fraca, packaging sem qty)
 *   LOW    → vai-guardar-lixo: code, nome genérico, descartável, perda de produto
 *
 * Regra de agregação (NÃO worst-of-three):
 *   • LOW se qualquer sinal "hard" (code/generic/lost/disposable),
 *     OU 2+ sinais quaisquer juntos.
 *   • MEDIUM se exactamente 1 sinal não-hard.
 *   • HIGH se 0 sinais.
 *
 * needsReview = (confidence === 'low'). Em form individual, só LOW pede
 * confirmação. Em bulk import, MEDIUM também ganha dot subtil — bar diferente
 * porque o chef revê em batch.
 */

import type { ArticleIntent } from './articleDraft'

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export type ConfidenceReason =
  | 'name_is_code'
  | 'name_too_generic'
  | 'product_name_lost_risk'
  | 'category_uncertain'
  | 'possible_disposable'
  | 'intent_uncertain'

export type ConfidenceVerdict = {
  confidence:  ConfidenceLevel
  reasons:     ConfidenceReason[]
  needsReview: boolean
}

// ── Listas frozen ────────────────────────────────────────────────────────────

// Standalone disposable keywords — `containsWord` plural-tolerante.
// 'papel' fica DE FORA: aprovação explícita do chef — só conta em compostos
// (ver DISPOSABLE_PAPEL_PHRASES). Razão: 'papel' isolado pode aparecer em
// produtos legítimos que não queremos marcar como descartável.
const DISPOSABLE_STANDALONE = [
  'kraft',
  'aluminio', 'alumínio',
  'pelicula', 'película',
  'vacuo', 'vácuo',
  'descartavel', 'descartável',
  'compactor', 'compactador',
  'talher', 'talheres',
  'guardanapo', 'guardanapos',
  'palhinha', 'palhinhas',
]

// Compostos com 'papel' — match literal substring (accent-stripped).
// 'papel mãos' / 'papel absorvente' / 'papel alumínio' / 'papel vegetal'
// são as quatro frases aprovadas pelo chef.
const DISPOSABLE_PAPEL_PHRASES = [
  'papel maos', 'papel mãos',
  'papel absorvente',
  'papel aluminio', 'papel alumínio',
  'papel vegetal',
]

// Container/embalagem genéricos que isolados não são produto.
// Match contra `finalName` lowercase + accent-strip (palavra única).
const GENERIC_CONTAINER_WORDS = new Set([
  'caixa', 'caixas', 'cx',
  'saco', 'sacos', 'sacola',
  'pacote', 'pacotes', 'pack', 'packs',
  'embalagem', 'embalagens', 'emb',
  'frasco', 'frascos',
  'lata', 'latas',
  'garrafa', 'garrafas', 'garrafao',
  'balde', 'baldes',
  'bisnaga',
  'fardo', 'fardos',
  'tabuleiro', 'tabuleiros',
])

// Palavras de ingrediente que isoladas não chegam para definir o artigo —
// "molho" pode ser inglês, soja, ostra, hoisin, picante… Chef precisa de
// confirmar qual. Multi-palavra ("molho inglês") não dispara — basta isTooGeneric
// rejeitar nomes com espaço.
const GENERIC_INGREDIENT_WORDS = new Set([
  'molho', 'molhos',
])

// ── Helpers internos ─────────────────────────────────────────────────────────

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function containsWord(text: string, keyword: string): boolean {
  const t = stripDiacritics(text.toLowerCase())
  const k = stripDiacritics(keyword.toLowerCase())
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\W)${escaped}(?:s|es)?(?=\\W|$)`, 'i').test(t)
}

/**
 * `name_is_code`: nome restante é só código alfanumérico tipo `COD123`,
 * `ART.456`, `REF9988`, `CX6`, ou < 3 chars. Permite 0–5 letras antes,
 * separador opcional, dígitos obrigatórios, 0–3 letras + dígitos no fim.
 *
 * Limites apertados para não apanhar produtos como "Vinho 10 Anos" (há
 * espaços; já filtra no replace), "100% Cocoa", "B12 Vitamina".
 */
function isCodeName(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed.length === 0) return true
  if (trimmed.length < 3)   return true
  // Sem espaços no nome (códigos não têm espaços, produtos quase sempre têm)
  if (/\s/.test(trimmed)) return false
  return /^[A-Z]{0,5}[.\-]?\d+[A-Z]{0,3}\d*$/i.test(trimmed)
}

function isTooGeneric(name: string): boolean {
  const lower = stripDiacritics(name.toLowerCase().trim())
  // Apenas quando o nome final é uma única palavra. Multi-palavra ("Molho
  // Inglês", "Caixa Cartão") nunca dispara — chef já qualificou.
  if (/\s/.test(lower)) return false
  return GENERIC_CONTAINER_WORDS.has(lower) || GENERIC_INGREDIENT_WORDS.has(lower)
}

function hasDisposableKeyword(rawInput: string): boolean {
  for (const kw of DISPOSABLE_STANDALONE) {
    if (containsWord(rawInput, kw)) return true
  }
  const lowerNorm = stripDiacritics(rawInput.toLowerCase())
  for (const phrase of DISPOSABLE_PAPEL_PHRASES) {
    const phraseNorm = stripDiacritics(phrase.toLowerCase())
    if (lowerNorm.includes(phraseNorm)) return true
  }
  return false
}

// ── API pública ──────────────────────────────────────────────────────────────

export type AssessConfidenceArgs = {
  rawInput:          string
  finalName:         string
  category:          string | null
  categoryConfident: boolean
  intent:            ArticleIntent
  trace:             { strippedPackagingNoQty: boolean }
  /** Label de packaging detectada pelo parser, se alguma. */
  detectedLabel?:    string
  /** Quantidade detectada em base_unit, se alguma. */
  detectedQty?:      number
}

export function assessConfidence(args: AssessConfidenceArgs): ConfidenceVerdict {
  const reasons: ConfidenceReason[] = []

  // 1. name_is_code — código sem produto reconhecível
  if (isCodeName(args.finalName)) reasons.push('name_is_code')

  // 2. name_too_generic — só uma container word
  if (isTooGeneric(args.finalName)) reasons.push('name_too_generic')

  // 3. product_name_lost_risk — packaging stripped sem qty E nome final
  //    é fraco (≤ 1 palavra significativa) E categoria não confirma o nome
  //    como alimento legítimo. Sem o 3º guard, "frango caixa" disparava
  //    falso positivo. Com o guard, só dispara em "caixa pizza" / "saco vácuo"
  //    onde o produto está em Embalagens ou sem categoria — sinal real.
  if (args.trace.strippedPackagingNoQty) {
    const sigWords = args.finalName.trim().split(/\s+/).filter(w => w.length > 2)
    const weakCategory = args.category === null || args.category === 'Embalagens e Descartáveis'
    if (sigWords.length <= 1 && weakCategory) {
      reasons.push('product_name_lost_risk')
    }
  }

  // 4. possible_disposable — keyword/composto de descartável no input
  if (hasDisposableKeyword(args.rawInput)) reasons.push('possible_disposable')

  // 5. category_uncertain — categoria não confiante ou ausente
  if (!args.categoryConfident || !args.category) reasons.push('category_uncertain')

  // 6. intent_uncertain — chef indicou packaging mas o parser não tem qty.
  //    Dois caminhos para chegar aqui:
  //      (a) `detectedLabel` foi extraído mas o intent é loose (ex: "2 caixas"
  //          sem peso → cl.type='packaging' sem factor)
  //      (b) `strippedPackagingNoQty` — uma container word foi removida do
  //          nome no branch unit sem número adjacente ("arroz saco",
  //          "azeite garrafa", "frango caixa")
  //    Não dispara para nomes puros sem packaging ("molho inglês", "frango") —
  //    esses são nomes limpos, intent loose é natural sem container word.
  const intentKind = args.intent.kind
  if (
    (intentKind === 'COUNTABLE_UNIT' || intentKind === 'WEIGHT_LOOSE' || intentKind === 'VOLUME') &&
    (args.detectedLabel != null || args.trace.strippedPackagingNoQty)
  ) {
    reasons.push('intent_uncertain')
  }

  // ── Agregação ──────────────────────────────────────────────────────────────
  const HARD_LOW: Set<ConfidenceReason> = new Set([
    'name_is_code',
    'name_too_generic',
    'product_name_lost_risk',
    'possible_disposable',
  ])
  const hasHardLow = reasons.some(r => HARD_LOW.has(r))
  const isLow      = hasHardLow || reasons.length >= 2

  if (isLow) {
    return { confidence: 'low', reasons, needsReview: true }
  }
  if (reasons.length === 1) {
    return { confidence: 'medium', reasons, needsReview: false }
  }
  return { confidence: 'high', reasons: [], needsReview: false }
}

// ── Labels human-readable ────────────────────────────────────────────────────
// Texto curto pt-pt para mostrar ao chef (form ou bulk import). Mantido aqui
// para que UI fique simétrica e a tradução viva ao lado da regra que disparou.

export const CONFIDENCE_REASON_LABELS: Record<ConfidenceReason, string> = {
  name_is_code:           'Parece um código, não um nome.',
  name_too_generic:       'Só uma embalagem, sem produto.',
  product_name_lost_risk: 'Pode faltar o produto.',
  category_uncertain:     'Categoria por confirmar.',
  possible_disposable:    'Pode ser descartável, não alimento.',
  intent_uncertain:       'Embalagem sem peso/quantidade.',
}
