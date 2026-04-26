'use client'

import type { CurrentStock } from '@/types/database'
import { formatBaseQty } from '@/lib/units'

interface ArticleCardProps {
  article:     CurrentStock
  isExpanded?: boolean
  isSaving?:   boolean
  isCounted?:  boolean
  isSkipped?:  boolean
  onClick:     () => void
}

/**
 * Card de artigo no Inventário. Header clicável: ao tocar, o parent
 * abre o Numpad com o stock_unit do artigo. Sem <input> nativo — o
 * teclado iOS não pode aparecer aqui (regra mobile-first).
 */
export default function ArticleCard({
  article,
  isExpanded,
  isSaving,
  isCounted,
  isSkipped,
  onClick,
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
        border:       `1px solid ${isExpanded ? 'var(--action)' : 'var(--border)'}`,
        borderRadius: 12,
        overflow:     'hidden',
        transition:   'all 0.15s',
      }}
    >
      <button
        onClick={onClick}
        disabled={isSaving}
        style={{
          width:         '100%',
          background:    'transparent',
          border:        'none',
          padding:       '12px 16px 10px',
          cursor:        isSaving ? 'default' : 'pointer',
          textAlign:     'left',
          display:       'flex',
          flexDirection: 'column',
          gap:           8,
        }}
      >
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
              {isSkipped && !isCounted && (
                <span
                  aria-label="Saltado nesta sessão"
                  style={{
                    fontFamily: 'var(--font-mono), monospace',
                    fontSize:   13,
                    color:      'var(--text-subtle)',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  ?
                </span>
              )}
              {isSaving && (
                <span style={{ fontSize: 12, color: 'var(--text-subtle)', flexShrink: 0 }}>…</span>
              )}
            </p>
            {article.category && (
              <p style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>
                {article.category}
              </p>
            )}
          </div>

          <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
            <span style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize:   20,
              fontWeight: 700,
              color:      statusColor,
            }}>
              {formatBaseQty(article.current_qty, article.unit)}
            </span>
          </div>
        </div>

        <div style={{ height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{
            height:     '100%',
            width:      `${pct}%`,
            borderRadius: 2,
            background: isBelowPar ? 'var(--error)' : 'var(--success)',
            transition: 'width 0.3s',
          }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
            Par:{' '}
            <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
              {formatBaseQty(article.par_level, article.unit)}
            </span>
          </span>
          {isBelowPar && (
            <span style={{ fontSize: 11, color: 'var(--error)', fontFamily: 'JetBrains Mono, monospace' }}>
              −{formatBaseQty(Math.abs(article.diff_from_par), article.unit)}
            </span>
          )}
        </div>
      </button>
    </div>
  )
}
