/**
 * Formata uma quantidade com a sua unidade, aplicando conversão inteligente:
 * g < 1000 → "X gr" | g ≥ 1000 → "X kg"
 * mL/ml < 1000 → "X ml" | mL/ml ≥ 1000 → "X lt"
 * outras unidades → "X unit"
 */
export function formatStockQty(qty: number, unit: string): string {
  const fmt = (n: number) => n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)
  if (unit === 'g') {
    if (qty >= 1000) {
      const kg = qty / 1000
      return `${kg % 1 === 0 ? kg.toFixed(0) : kg.toFixed(1)} kg`
    }
    return `${qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(1)} gr`
  }
  if (unit === 'mL' || unit === 'ml') {
    if (qty >= 1000) {
      const l = qty / 1000
      return `${l % 1 === 0 ? l.toFixed(0) : l.toFixed(1)} lt`
    }
    return `${qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(1)} ml`
  }
  return `${fmt(qty)} ${unit}`
}

// Unidades de embalagem para campo UN. COMPRA (fornecedores)
export const ORDER_UNITS = [
  'caixa', 'saco', 'frasco', 'lata', 'garrafa', 'pacote', 'balde', 'tabuleiro', 'bisnaga',
  'maço', 'folha', 'ramo', 'dente',
]

// Unidades de medida comuns em cozinha profissional
export const KITCHEN_UNITS = [
  // Peso
  'kg', 'g', 'mg',
  // Volume
  'L', 'mL', 'cl', 'dl',
  // Contagem
  'un', 'dose', 'porção', 'fatia', 'peça',
  // Embalagem
  'caixa', 'saco', 'frasco', 'lata', 'garrafa', 'pacote', 'balde', 'tabuleiro', 'bisnaga',
  // Outros
  'maço', 'folha', 'ramo', 'dente', 'colher', 'colher de sopa', 'colher de chá',
]
