'use client'

import { useCallback } from 'react'

interface NumericKeypadProps {
  value:    string
  onChange: (value: string) => void
  onConfirm?: () => void
  unit?: string
  maxDecimals?: number
}

const KEYS = [
  '7', '8', '9',
  '4', '5', '6',
  '1', '2', '3',
  '.', '0', '⌫',
]

export default function NumericKeypad({
  value,
  onChange,
  onConfirm,
  unit,
  maxDecimals = 3,
}: NumericKeypadProps) {

  const handleKey = useCallback((key: string) => {
    if (key === '⌫') {
      onChange(value.length > 1 ? value.slice(0, -1) : '0')
      return
    }

    if (key === '.') {
      if (value.includes('.')) return
      onChange(value + '.')
      return
    }

    // Leading zero guard
    const next = value === '0' ? key : value + key

    // Enforce max decimals
    const dotIdx = next.indexOf('.')
    if (dotIdx !== -1 && next.length - dotIdx - 1 > maxDecimals) return

    onChange(next)
  }, [value, onChange, maxDecimals])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Display */}
      <div style={{
        background:   'var(--bg)',
        border:       '1px solid var(--border)',
        borderRadius: 12,
        padding:      '16px 20px',
        display:      'flex',
        alignItems:   'baseline',
        justifyContent: 'flex-end',
        gap: 8,
      }}>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize:   40,
          fontWeight: 600,
          color:      'var(--text)',
          letterSpacing: '-1px',
        }}>
          {value || '0'}
        </span>
        {unit && (
          <span style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize:   18,
            color:      'var(--text-subtle)',
          }}>
            {unit}
          </span>
        )}
      </div>

      {/* Keys grid */}
      <div style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap:                 8,
      }}>
        {KEYS.map((key) => {
          const isBackspace = key === '⌫'

          return (
            <button
              key={key}
              onClick={() => handleKey(key)}
              style={{
                height:         60,
                minHeight:      44,
                borderRadius:   10,
                border:         '1px solid var(--border)',
                background:     isBackspace ? 'var(--surface-2)' : 'var(--surface)',
                color:          isBackspace ? 'var(--text-muted)' : 'var(--text)',
                fontFamily:     'JetBrains Mono, monospace',
                fontSize:       isBackspace ? 20 : 22,
                fontWeight:     500,
                cursor:         'pointer',
                transition:     'background 0.1s, transform 0.05s',
                userSelect:     'none',
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
              }}
              onMouseDown={(e) => {
                const t = e.currentTarget
                t.style.background = 'var(--surface-2)'
                t.style.transform  = 'scale(0.96)'
              }}
              onMouseUp={(e) => {
                const t = e.currentTarget
                t.style.background = isBackspace ? 'var(--surface-2)' : 'var(--surface)'
                t.style.transform  = 'scale(1)'
              }}
              onTouchStart={(e) => {
                const t = e.currentTarget
                t.style.background = 'var(--surface-2)'
                t.style.transform  = 'scale(0.96)'
              }}
              onTouchEnd={(e) => {
                const t = e.currentTarget
                t.style.background = isBackspace ? 'var(--surface-2)' : 'var(--surface)'
                t.style.transform  = 'scale(1)'
              }}
            >
              {key}
            </button>
          )
        })}
      </div>

      {/* Confirm button */}
      {onConfirm && (
        <button
          onClick={onConfirm}
          disabled={isNaN(parseFloat(value))}
          style={{
            height:         60,
            minHeight:      44,
            borderRadius:   10,
            border:         'none',
            background:     'var(--action)',
            color:          'var(--text-on-primary)',
            fontSize:       16,
            fontWeight:     600,
            cursor:         'pointer',
            transition:     'background 0.15s',
            letterSpacing:  '0.02em',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--action-hover)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--action)' }}
        >
          Confirmar Contagem
        </button>
      )}
    </div>
  )
}
