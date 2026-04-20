'use client'

import type { CurrentProductionStock, ProductionWithCost } from '@/types/database'

interface ProductionCardProps {
  production: CurrentProductionStock & Partial<ProductionWithCost>
  isSelected: boolean
  onClick:    () => void
}

export default function ProductionCard({ production, isSelected, onClick }: ProductionCardProps) {
  const hasCost = production.cost_per_unit != null && production.cost_per_unit > 0

  return (
    <button
      onClick={onClick}
      style={{
        width:         '100%',
        minHeight:     68,
        background:    isSelected ? 'rgba(196,106,45,0.08)' : 'var(--surface)',
        border:        `1px solid ${isSelected ? 'var(--action)' : 'var(--border)'}`,
        borderRadius:  12,
        padding:       '12px 16px',
        cursor:        'pointer',
        textAlign:     'left',
        transition:    'all 0.15s',
        display:       'flex',
        flexDirection: 'column',
        gap:           6,
      }}
    >
      {/* Name + cost */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <p style={{
          fontSize:     15,
          fontWeight:   600,
          color:        'var(--text)',
          whiteSpace:   'nowrap',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          flex:         1,
          minWidth:     0,
        }}>
          {production.name}
        </p>

        {hasCost && (
          <span style={{
            fontFamily:  'JetBrains Mono, monospace',
            fontSize:    13,
            fontWeight:  600,
            color:       'var(--action)',
            flexShrink:  0,
            marginLeft:  12,
          }}>
            {production.cost_per_unit!.toFixed(2)} €/{production.unit}
          </span>
        )}
      </div>

      {/* Stock atual */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Stock:</span>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize:   13,
          fontWeight: 600,
          color:      production.current_qty > 0 ? 'var(--text)' : 'var(--text-subtle)',
        }}>
          {production.current_qty % 1 === 0
            ? production.current_qty.toFixed(0)
            : production.current_qty.toFixed(1)
          } {production.unit}
        </span>
        {production.current_qty === 0 && (
          <span style={{
            fontSize:      10,
            fontWeight:    600,
            color:         'var(--action-hover)',
            letterSpacing: '0.05em',
          }}>
            SEM STOCK
          </span>
        )}
      </div>

      {/* Yield info */}
      <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
        Rende{' '}
        <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
          {production.yield_qty} {production.unit}
        </span>
      </div>
    </button>
  )
}
