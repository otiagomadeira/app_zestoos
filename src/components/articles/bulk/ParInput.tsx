// ── ParInput — numeric + sufixo (counting_unit) ──────────────────────────────

export function ParInput({
  value, suffix, onChange,
}: {
  value:    string
  suffix:   string
  onChange: (v: string) => void
}) {
  return (
    <div style={{
      display:      'inline-flex',
      alignItems:   'center',
      height:       44,
      background:   'var(--surface)',
      border:       '1px solid var(--border)',
      borderRadius: 6,
      padding:      '0 12px',
      gap:          8,
      minWidth:     168,
      flex:         '0 1 auto',
    }}>
      <span style={{
        fontSize:    12,
        fontWeight:  600,
        color:       'var(--text-muted)',
        whiteSpace:  'nowrap',
      }}>
        Mínimo:
      </span>
      <input
        type="text"
        inputMode="decimal"
        placeholder="0"
        aria-label="Stock mínimo"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width:      56,
          background: 'transparent',
          border:     'none',
          outline:    'none',
          color:      'var(--text)',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize:   16,  // ≥16 evita zoom iOS no focus + sinal de campo principal
          fontWeight: 700,
          textAlign:  'right',
          padding:    0,
        }}
      />
      <span style={{
        fontSize:   12,
        fontWeight: 500,
        color:      'var(--text-muted)',
        fontFamily: 'JetBrains Mono, monospace',
        whiteSpace: 'nowrap',
      }}>
        {suffix}
      </span>
    </div>
  )
}
