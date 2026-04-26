import { formatBaseQty } from '@/lib/units'

// Insere espaço entre dígito-letra e letra-dígito em labels colados
// ("saco25kg" → "saco 25 kg", "5L" → "5 L", "200g" → "200 g").
export function spaceDigitsAndLetters(s: string): string {
  return s
    .replace(/([a-zA-Zµ])(\d)/g, '$1 $2')
    .replace(/(\d)\s*([a-zA-Zµ])/g, '$1 $2')
}

// Trivial: a augmentação com formatBaseQty(base, baseUnit) não acrescenta
// informação útil. Acontece quando:
//   - base == 1 e baseUnit == 'un' ("1 un" não diz nada)
//   - label coincide com baseUnit ("Balde" + baseUnit "balde", "kg" + baseUnit "kg")
function isTrivialSize(label: string, basePerUnit: number, baseUnit: string): boolean {
  if (basePerUnit !== 1) return false
  if (baseUnit === 'un') return true
  if (label.toLowerCase() === baseUnit.toLowerCase()) return true
  return false
}

/**
 * Formata o label da embalagem como o cozinheiro a vê e conta fisicamente.
 *
 * O input do `InlineCountRow` (e cada linha do multi `ExpandedBody`) representa
 * **quantidade dessa embalagem**. Esta função transforma os 3 inputs do modelo
 * (label do chef + base_per_unit + base_unit do artigo) num texto operacional.
 *
 * Regras (ordem importa):
 *   1. `"X solto"` → `"X"`                   — fallback auto-gerado, strip suffix
 *   2. `"1000mL"` / `"500g"` / `"5L"`        — pure numeric+unit ("técnico"):
 *      reformatar via `formatBaseQty(base_per_unit, base_unit)` (auto-converte
 *      g→kg, mL→L). Garante que `"1000mL"` aparece como `"1 L"`, nunca como `"1000…"`.
 *   3. `"saco 25kg"` / `"cx5kg"` / `"caixa 6un"` — label com dígitos misturado
 *      com texto: confiar no chef e só normalizar espaços via `spaceDigitsAndLetters`.
 *   4. `"saco"` / `"garrafão"` / `"caixa"` — label sem dígitos (só "tipo de
 *      embalagem"). Aumenta com `" " + formatBaseQty(...)` excepto quando trivial:
 *        - `base==1` e `baseUnit=='un'` → label só (`"molho"`)
 *        - `label.toLowerCase() === baseUnit` → label só (`"Balde"` em baseUnit `balde`)
 *
 * NUNCA expõe `base_per_unit` ou `conversion_factor` cru — sempre via `formatBaseQty`.
 */
export function formatPackagingLabel(
  label:        string,
  basePerUnit:  number,
  baseUnit:     string,
): string {
  const trimmed = label.trim()
  if (!trimmed) return ''

  // 1. Fallback "X solto" → "X"
  const soltoMatch = trimmed.match(/^(.+?)\s+solto$/i)
  if (soltoMatch) return soltoMatch[1]

  // 2. Pure técnico ("1000mL", "500g", "5L"): reformatar via formatBaseQty
  const technicalMatch = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Zµ]+)$/)
  if (technicalMatch) {
    return formatBaseQty(basePerUnit, baseUnit)
  }

  // 3. Misto com dígitos ("saco 25kg") — normalizar espaços e devolver
  if (/\d/.test(trimmed)) {
    return spaceDigitsAndLetters(trimmed)
  }

  // 4. Tipo-only sem dígito: aumentar com tamanho a menos que trivial
  if (isTrivialSize(trimmed, basePerUnit, baseUnit)) {
    return trimmed
  }
  return `${trimmed} ${formatBaseQty(basePerUnit, baseUnit)}`
}
