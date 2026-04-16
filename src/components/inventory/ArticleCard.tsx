'use client'

import type { CurrentStock } from '@/types/database'

interface ArticleCardProps {
  article:    CurrentStock
  isSelected: boolean
  isDirty?:   boolean
  newQty?:    string
  onClick:    () => void
}

export default function ArticleCard({
  article,
  isSelected,
  isDirty,
  newQty,
  onClick,
}: ArticleCardProps) {
  const isBelowPar = article.current_qty < article.par_level
  const displayQty = isDirty && newQty !== undefined ? parseFloat(newQty) || 0 : article.current_qty

  const statusColor = isBelowPar ? '#EF4444' : '#22C55E'
  const pct = article.par_level > 0
    ? Math.min((article.current_qty / article.par_level) * 100, 100)
    : 100

  return (
    <button
      onClick={onClick}
      style={{
        width:          '100%',
        minHeight:      72,
        background:     isSelected ? 'rgba(255, 95, 31, 0.08)' : '#141414',
        border:         `1px solid ${isSelected ? '#FF5F1F' : isDirty ? '#F59E0B' : '#2A2A2A'}`,
        borderRadius:   12,
        padding:        '12px 16px',
        cursor:         'pointer',
        textAlign:      'left',
        transition:     'all 0.15s',
        display:        'flex',
        flexDirection:  'column',
        gap:            8,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontFamily: 'Inter, sans-serif',
            fontSize:   15,
            fontWeight: 600,
            color:      '#F5F5F5',
            whiteSpace: 'nowrap',
            overflow:   'hidden',
            textOverflow: 'ellipsis',
          }}>
            {article.name}
          </p>
          {article.category && (
            <p style={{ fontSize: 11, color: '#555555', marginTop: 1 }}>
              {article.category}
            </p>
          )}
        </div>

        {/* Stock qty */}
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
          <span style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize:   20,
            fontWeight: 700,
            color:      isDirty ? '#F59E0B' : statusColor,
          }}>
            {isDirty ? (parseFloat(newQty ?? '0') || 0).toFixed(
              Number.isInteger(parseFloat(newQty ?? '0')) ? 0 : 1
            ) : article.current_qty % 1 === 0
              ? article.current_qty.toFixed(0)
              : article.current_qty.toFixed(1)
            }
          </span>
          <span style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize:   11,
            color:      '#555555',
            marginLeft: 4,
          }}>
            {article.unit}
          </span>
        </div>
      </div>

      {/* Progress bar — par level indicator */}
      <div style={{
        height:       3,
        borderRadius: 2,
        background:   '#1C1C1C',
        overflow:     'hidden',
      }}>
        <div style={{
          height:       '100%',
          width:        `${pct}%`,
          borderRadius: 2,
          background:   isBelowPar ? '#EF4444' : '#22C55E',
          transition:   'width 0.3s',
        }} />
      </div>

      {/* Par level info */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: '#555555' }}>
          Par: <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9A9A9A' }}>
            {article.par_level} {article.unit}
          </span>
        </span>
        {isBelowPar && (
          <span style={{ fontSize: 11, color: '#EF4444', fontFamily: 'JetBrains Mono, monospace' }}>
            −{Math.abs(article.diff_from_par).toFixed(1)} {article.unit}
          </span>
        )}
        {isDirty && (
          <span style={{
            fontSize:   10,
            color:      '#F59E0B',
            fontWeight: 600,
            letterSpacing: '0.05em',
          }}>
            ALTERADO
          </span>
        )}
      </div>
    </button>
  )
}
