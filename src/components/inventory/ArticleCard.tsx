'use client'

import type { CurrentStock } from '@/types/database'
import { formatStockQty } from '@/lib/units'

export type SizeRow = {
  size_label:    string   // label de display (ex: "saco 200g")
  qty:           string   // valor no input (string para edição)
  base_per_unit: number   // base_units por unidade
}

interface ArticleCardProps {
  article:             CurrentStock
  isSelected:          boolean
  isDirty?:            boolean
  isExpanded?:         boolean
  isSaving?:           boolean
  isCounted?:          boolean
  onClick:             () => void
  onConfirm?:          () => void
  // Modo simples (sem tamanhos configurados)
  newQty?:             string
  onQtyChange?:        (val: string) => void
  // Modo multi-tamanho
  sizeRows?:           SizeRow[]
  onSizeRowChange?:    (idx: number, qty: string) => void
}

export default function ArticleCard({
  article,
  isSelected,
  isDirty,
  isExpanded,
  isSaving,
  isCounted,
  onClick,
  onConfirm,
  newQty,
  onQtyChange,
  sizeRows,
  onSizeRowChange,
}: ArticleCardProps) {
  const isMultiSize  = (sizeRows?.length ?? 0) > 0
  const isBelowPar   = article.current_qty < article.par_level
  const statusColor  = isBelowPar ? 'var(--error)' : 'var(--success)'
  const pct          = article.par_level > 0
    ? Math.min((article.current_qty / article.par_level) * 100, 100)
    : 100

  // Totais para o modo multi-tamanho
  const totalUnits = isMultiSize
    ? (sizeRows ?? []).reduce((s, r) => s + (parseFloat(r.qty) || 0), 0)
    : 0
  const totalBase  = isMultiSize
    ? (sizeRows ?? []).reduce((s, r) => s + (parseFloat(r.qty) || 0) * r.base_per_unit, 0)
    : 0

  return (
    <div
      style={{
        width:        '100%',
        background:   isExpanded ? 'rgba(196,106,45,0.06)' : isSelected ? 'rgba(196,106,45,0.04)' : 'var(--surface)',
        border:       `1px solid ${isExpanded ? 'var(--action)' : isDirty ? '#B8860B' : 'var(--border)'}`,
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
              color:      isDirty ? '#A07010' : statusColor,
            }}>
              {formatStockQty(article.current_qty, article.stock_unit)}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, borderRadius: 2, background: 'rgba(28,20,10,0.1)', overflow: 'hidden' }}>
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
              {formatStockQty(article.par_level, article.stock_unit)}
            </span>
          </span>
          {isBelowPar && !isDirty && (
            <span style={{ fontSize: 11, color: 'var(--error)', fontFamily: 'JetBrains Mono, monospace' }}>
              −{formatStockQty(Math.abs(article.diff_from_par), article.stock_unit)}
            </span>
          )}
          {isDirty && (
            <span style={{ fontSize: 10, color: '#A07010', fontWeight: 600, letterSpacing: '0.05em' }}>
              ALTERADO
            </span>
          )}
        </div>
      </button>

      {/* Expanded: multi-tamanho */}
      {isExpanded && isMultiSize && (
        <div
          style={{
            padding:    '0 16px 14px',
            borderTop:  '1px solid rgba(28,20,10,0.1)',
            paddingTop: 12,
            marginTop:  -2,
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Linhas por tamanho */}
          {(sizeRows ?? []).map((row, idx) => {
            const qty = parseFloat(row.qty) || 0
            return (
              <div
                key={idx}
                style={{
                  display:        'flex',
                  alignItems:     'center',
                  gap:            8,
                  marginBottom:   10,
                }}
              >
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
                  {row.size_label}
                </span>
                {/* Stepper */}
                <button
                  onClick={() => onSizeRowChange?.(idx, String(Math.max(0, qty - 1)))}
                  style={stepperBtn}
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="1"
                  value={row.qty}
                  onChange={e => onSizeRowChange?.(idx, e.target.value)}
                  style={{
                    width:        52,
                    height:       40,
                    background:   'var(--bg)',
                    border:       '1px solid rgba(28,20,10,0.2)',
                    borderRadius: 8,
                    padding:      '0 6px',
                    fontSize:     16,
                    fontFamily:   'JetBrains Mono, monospace',
                    fontWeight:   600,
                    color:        'var(--text)',
                    outline:      'none',
                    textAlign:    'center',
                  }}
                />
                <button
                  onClick={() => onSizeRowChange?.(idx, String(qty + 1))}
                  style={stepperBtn}
                >
                  +
                </button>
              </div>
            )
          })}

          {/* Total + botão guardar */}
          <div style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            borderTop:      '1px dashed var(--border)',
            paddingTop:     10,
            marginTop:      2,
          }}>
            <div>
              <span style={{ fontSize: 13, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--text)' }}>
                {totalUnits.toFixed(totalUnits % 1 === 0 ? 0 : 1)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-subtle)', marginLeft: 4 }}>
                {article.stock_unit}
              </span>
              {totalBase > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-subtle)', marginLeft: 6 }}>
                  · {totalBase >= 1000 ? `${(totalBase / 1000).toFixed(1)} k` : totalBase.toFixed(0)} {article.unit}
                </span>
              )}
            </div>
            <button
              onClick={onConfirm}
              disabled={isSaving || totalUnits === 0}
              style={{
                height:       40,
                padding:      '0 16px',
                borderRadius: 8,
                border:       'none',
                background:   (isSaving || totalUnits === 0) ? 'rgba(196,106,45,0.35)' : 'var(--action)',
                color:        '#FFFFFF',
                fontSize:     14,
                fontWeight:   700,
                cursor:       (isSaving || totalUnits === 0) ? 'default' : 'pointer',
                flexShrink:   0,
              }}
            >
              {isSaving ? '…' : '✓ Guardar'}
            </button>
          </div>
        </div>
      )}

      {/* Expanded: modo simples */}
      {isExpanded && !isMultiSize && (
        <div
          style={{
            padding:    '0 16px 14px',
            display:    'flex',
            alignItems: 'center',
            gap:        8,
            borderTop:  '1px solid rgba(28,20,10,0.1)',
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
                {formatStockQty(article.current_qty, article.stock_unit)}
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
              border:       '1px solid rgba(28,20,10,0.2)',
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
            {article.stock_unit}
          </span>
          <button
            onClick={onConfirm}
            disabled={isSaving}
            style={{
              width:        44,
              height:       40,
              borderRadius: 8,
              border:       'none',
              background:   isSaving ? 'rgba(196,106,45,0.4)' : 'var(--action)',
              color:        '#FFFFFF',
              fontSize:     18,
              fontWeight:   700,
              cursor:       isSaving ? 'default' : 'pointer',
              flexShrink:   0,
              display:      'flex',
              alignItems:   'center',
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

const stepperBtn: React.CSSProperties = {
  width:        40,
  height:       40,
  borderRadius: 8,
  border:       '1px solid rgba(28,20,10,0.15)',
  background:   'var(--surface)',
  color:        'var(--text)',
  fontSize:     20,
  fontWeight:   400,
  cursor:       'pointer',
  flexShrink:   0,
  display:      'flex',
  alignItems:   'center',
  justifyContent: 'center',
  lineHeight:   1,
}
