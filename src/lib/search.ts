import { normalizeKey } from './ingredientDictionary'

// Normaliza texto para pesquisa tolerante:
// - lower + trim + NFD + strip diacritics (via normalizeKey)
// - colapsa whitespace interno (múltiplos espaços/tabs → 1 espaço)
// - remove pontuação simples (.,;:!?·-_/\)
//
// Usar em ambos os lados da comparação (needle e haystack).
export function searchNormalize(s: string): string {
  return normalizeKey(s)
    .replace(/[.,;:!?·\-_/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Retorna true se `haystack` contém `needle` após searchNormalize.
// Needle vazia → true (não filtra).
export function searchMatch(needle: string, haystack: string): boolean {
  const q = searchNormalize(needle)
  if (!q) return true
  return searchNormalize(haystack).includes(q)
}
