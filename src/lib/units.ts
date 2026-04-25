// Formata value + unit com conversão automática e máx 2 casas decimais:
// g < 1000 → "X g"  | g ≥ 1000 → "X kg"
// mL/ml < 1000 → "X ml" | mL/ml ≥ 1000 → "X L"
// outras → "X unit"
export function formatUnit(value: number, unit: string): string {
  const fmt = (n: number) => String(+(n.toFixed(2)))
  if (unit === 'g')               return value >= 1000 ? `${fmt(value / 1000)} kg` : `${fmt(value)} g`
  if (unit === 'mL' || unit === 'ml') return value >= 1000 ? `${fmt(value / 1000)} L`  : `${fmt(value)} ml`
  return `${fmt(value)} ${unit}`
}

export function formatStockQty(qty: number, unit: string): string {
  return formatUnit(qty, unit)
}

// Formata qty (em base_unit) para display em stock_unit:
// - stock_unit === unit → formatStockQty (auto-converte g→kg, mL→L)
// - stock_unit !== unit → divide por basePerStock e mostra com stock_unit
export function formatStockDisplay(
  qtyBase:      number,
  unit:         string,
  stockUnit:    string,
  basePerStock: number,
): string {
  if (stockUnit === unit || basePerStock <= 0) {
    return formatStockQty(qtyBase, unit)
  }
  const qty = qtyBase / basePerStock
  return `${+(qty.toFixed(2))} ${stockUnit}`
}

export function formatWeight(g: number): string {
  return formatUnit(g, 'g')
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
