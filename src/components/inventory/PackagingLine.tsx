'use client'

interface PackagingLineProps {
  label:    string
  value:    string
  onChange: (raw: string) => void
  onStep:   (delta: number) => void
  disabled?: boolean
}

/**
 * Linha de embalagem em contagem inline. Layout: [label] [−] [input] [+].
 * O input é nativo (inputMode="decimal") — em iOS abre só teclado numérico.
 * Aceita vírgula PT e ponto. Stepper incrementa 1 (preserva fração se já lá estiver).
 */
export default function PackagingLine({
  label,
  value,
  onChange,
  onStep,
  disabled,
}: PackagingLineProps) {
  const parsed = parseFloat((value || '0').replace(',', '.'))
  const decrementDisabled = disabled || isNaN(parsed) || parsed <= 0

  const handleChange = (raw: string) => {
    const cleaned = raw.replace(/[^\d.,]/g, '').slice(0, 8)
    onChange(cleaned)
  }

  return (
    <div style={{
      display:        'flex',
      alignItems:     'center',
      gap:            10,
      minHeight:      56,
      padding:        '8px 10px 8px 14px',
      borderRadius:   10,
      border:         '1px solid var(--border)',
      background:     'var(--surface)',
    }}>
      <span style={{
        fontSize:     14,
        fontWeight:   500,
        color:        'var(--text)',
        whiteSpace:   'nowrap',
        overflow:     'hidden',
        textOverflow: 'ellipsis',
        flex:         1,
        minWidth:     0,
      }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button
          type="button"
          aria-label={`Diminuir ${label}`}
          onClick={() => onStep(-1)}
          disabled={decrementDisabled}
          style={{
            width:          44,
            height:         44,
            borderRadius:   8,
            border:         '1px solid var(--border)',
            background:     'var(--surface-2)',
            color:          decrementDisabled ? 'var(--text-subtle)' : 'var(--text)',
            fontSize:       20,
            fontWeight:     700,
            lineHeight:     1,
            cursor:         decrementDisabled ? 'not-allowed' : 'pointer',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            opacity:        decrementDisabled ? 0.5 : 1,
            touchAction:    'manipulation',
          }}
        >−</button>
        <input
          type="text"
          inputMode="decimal"
          pattern="[0-9]*[.,]?[0-9]*"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="0"
          aria-label={`Quantidade de ${label}`}
          style={{
            width:        72,
            height:       44,
            background:   'var(--bg)',
            border:       '1px solid var(--border)',
            borderRadius: 8,
            color:        'var(--text)',
            fontFamily:   'var(--font-mono), monospace',
            fontSize:     17,
            fontWeight:   700,
            textAlign:    'center',
            padding:      '0 8px',
            outline:      'none',
          }}
        />
        <button
          type="button"
          aria-label={`Aumentar ${label}`}
          onClick={() => onStep(+1)}
          disabled={disabled}
          style={{
            width:          44,
            height:         44,
            borderRadius:   8,
            border:         '1px solid var(--action)',
            background:     'var(--action-surface)',
            color:          'var(--action)',
            fontSize:       20,
            fontWeight:     700,
            lineHeight:     1,
            cursor:         disabled ? 'not-allowed' : 'pointer',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            touchAction:    'manipulation',
          }}
        >+</button>
      </div>
    </div>
  )
}
