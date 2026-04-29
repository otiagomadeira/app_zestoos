import type { ParsedLine } from '@/lib/parseProductLines'
import { formatBaseQty } from '@/lib/units'

// ── SeedHint (read-only) ─────────────────────────────────────────────────────
// Usado no bloco expandido das OK lines E em DuplicateCard para o chef ver
// que info o parser captou. Render mesmo quando só há `qty` sem `stock_unit`
// (caso "tomate pelado 2.5kg") — é a única superfície onde a info aparece
// no fluxo de variante.

export function SeedHint({ line }: { line: ParsedLine }) {
  if (line.unit.trim() === '') return null
  const qtyFromOrder = parseFloat(line.base_per_order)
  const qtyFromLine  = parseFloat(line.qty)
  const qty          = !isNaN(qtyFromOrder) && qtyFromOrder > 0
    ? qtyFromOrder
    : !isNaN(qtyFromLine) && qtyFromLine > 0 ? qtyFromLine : 0
  const hasQty = qty > 0
  const mp     = line.detected_multipack

  if (!line.stock_unit && !hasQty && !mp) return null

  // formatBaseQty usa vírgula PT (mesmo formato que o botão "Adicionar
  // tamanho · {hint}"); formatUnit usa ponto. Antes desta troca o chef via
  // "Detetado: 2.5 kg" e clicava "Adicionar tamanho · 2,5 kg" — separadores
  // diferentes para o mesmo valor.
  let body: string
  if (mp) {
    body = line.stock_unit
      ? `${line.stock_unit} · ${mp.count} x ${formatBaseQty(mp.perPack, line.unit)}`
      : `${mp.count} x ${formatBaseQty(mp.perPack, line.unit)}`
  } else if (line.stock_unit && hasQty) {
    body = `${line.stock_unit} · ${formatBaseQty(qty, line.unit)}`
  } else if (line.stock_unit) {
    body = line.stock_unit
  } else {
    body = formatBaseQty(qty, line.unit)
  }

  return (
    <p style={{
      fontSize:      11,
      color:         'var(--text-subtle)',
      fontFamily:    'JetBrains Mono, monospace',
      letterSpacing: '0.02em',
      margin:        0,
    }}>
      Detetado: {body}
    </p>
  )
}
