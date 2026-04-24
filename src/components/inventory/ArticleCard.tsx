'use client'

import type { CurrentStock } from '@/types/database'
import { formatStockQty } from '@/lib/units'

interface ArticleCardProps {
  article:      CurrentStock
  isDirty?:     boolean
  isExpanded?:  boolean
  isSaving?:    boolean
  isCounted?:   boolean
  onClick:      () => void
  onConfirm?:   () => void
  newQty?:      string
  onQtyChange?: (val: string) => void
}

export default function ArticleCard({
  article,
  isDirty,
  isExpanded,
  isSaving,
  isCounted,
  onClick,
  onConfirm,
  newQty,
  onQtyChange,
}: ArticleCardProps) {
  const isBelowPar  = article.current_qty < article.par_level
  const statusColor = isBelowPar ? 'var(--error)' : 'var(--success)'
  const pct         = article.par_level > 0
    ? Math.min((article.current_qty / article.par_level) * 100, 100)
    : 100

  return (
    <div
      style={{
        width:        '100%',
        background:   isExpanded ? 'var(--action-surface)' : 'var(--surface)',
        border:       `1px solid ${isExpanded ? 'var(--action)' : isDirty ? 'var(--warning)' : 'var(--border)'}`,
        borderRadius: 12,
        overflow:     'hidden',
        transition:   'all 0.15s',
      }}
    >
      {/* Clickable top section */}
      <button
        onClick={onClick}
        style={{
          width:         '100%',
          background:    'transparent',
          border:        'none',
          padding:       '12px 16px 10px',
          cursor:        'pointer',
          textAlign:     'left',
          display:       'flex',
          flexDirection: 'column',
          gap:           8,
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize:     15,
              fontWeight:   600,
              color:        'var(--text)',
              whiteSpace:   'nowrap',
              overflow:     'hidden',
              textOverflow: 'ellipsis',
              display:      'flex',
              alignItems:   'center',
              gap:          6,
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{article.name}</span>
              {isCounted && (
                <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 700, flexShrink: 0 }}>✓</span>
              )}
            </p>
            {article.category && (
              <p style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>
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
              color:      isDirty ? 'var(--warning-text)' : statusColor,
            }}>
              {formatStockQty(article.current_qty, article.unit)}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{
            height:     '100%',
            width:      `${pct}%`,
            borderRadius: 2,
            background: isBelowPar ? 'var(--error)' : 'var(--success)',
            transition: 'width 0.3s',
          }} />
        </div>

        {/* Par level info */}
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
            Par:{' '}
            <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
              {formatStockQty(article.par_level, article.unit)}
            </span>
          </span>
          {isBelowPar && !isDirty && (
            <span style={{ fontSize: 11, color: 'var(--error)', fontFamily: 'JetBrains Mono, monospace' }}>
              −{formatStockQty(Math.abs(article.diff_from_par), article.unit)}
            </span>
          )}
          {isDirty && (
            <span style={{ fontSize: 10, color: 'var(--warning-text)', fontWeight: 600, letterSpacing: '0.05em' }}>
              ALTERADO
            </span>
          )}
        </div>
      </button>

      {/* Expanded: input de contagem */}
      {isExpanded && (
        <div
          style={{
            padding:    '0 16px 14px',
            display:    'flex',
            alignItems: 'center',
            gap:        8,
            borderTop:  '1px solid var(--border)',
            paddingTop: 12,
            marginTop:  -2,
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 2 }}>
            <label style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Novo:</label>
            <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
              atual:{' '}
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
                {formatStockQty(article.current_qty, article.unit)}
              </span>
            </span>
          </div>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            autoFocus
            value={newQty ?? ''}
            onChange={e => onQtyChange?.(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onConfirm?.() }}
            style={{
              flex:         1,
              height:       40,
              background:   'var(--bg)',
              border:       '1px solid var(--border)',
              borderRadius: 8,
              padding:      '0 10px',
              fontSize:     16,
              fontFamily:   'JetBrains Mono, monospace',
              fontWeight:   600,
              color:        'var(--text)',
              outline:      'none',
              minWidth:     0,
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-subtle)', flexShrink: 0 }}>
            {article.unit}
          </span>
          <button
            onClick={onConfirm}
            disabled={isSaving}
            style={{
              width:          44,
              height:         40,
              borderRadius:   8,
              border:         'none',
              background:     isSaving ? 'var(--action-disabled)' : 'var(--action)',
              color:          'var(--text-on-primary)',
              fontSize:       18,
              fontWeight:     700,
              cursor:         isSaving ? 'default' : 'pointer',
              flexShrink:     0,
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
            }}
          >
            {isSaving ? '…' : '✓'}
          </button>
        </div>
      )}
    </div>
  )
}
