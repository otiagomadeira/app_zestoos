import { ARTICLE_CATEGORIES } from '@/lib/categoryKeywords'

// ── CategoryChipSelect — chip subtil com <select> nativo invisível por cima ──
// Decisões cravadas:
//  • Sempre visível na linha compacta (mesmo sem categoria → "definir categoria")
//  • Lista canónica `ARTICLE_CATEGORIES`. Se a linha já tiver valor fora da
//    lista (alias legado), preserva-o como opção extra para não fazer reset.
//  • `<select>` ocupa toda a área da chip com opacity:0 → tap nativo iOS/Android
//    com picker do OS, zero código de dropdown custom. Chip mantém height=44
//    para tap target ≥44px, mas estilo (font 10, bg transparente, opacity 0.75)
//    fá-la ler como secundária ao lado de FORMATOS DE USO e MÍNIMO.
//  • categoryConfident=true é injectado em handleLineChange quando field='category'.
export function CategoryChipSelect({
  value, categoryConfident, onChange,
}: {
  value:             string
  categoryConfident: boolean
  onChange:          (v: string) => void
}) {
  const trimmed     = value.trim()
  const hasCategory = trimmed !== ''
  const isCanonical = (ARTICLE_CATEGORIES as readonly string[]).includes(trimmed)
  const showWarning = hasCategory && !categoryConfident
  const display     = hasCategory ? trimmed : 'definir categoria'

  // Preserva valor não-canónico como opção extra (alias legado, parser exótico).
  const extraOptions = hasCategory && !isCanonical ? [trimmed] : []

  return (
    <label style={{
      position:   'relative',
      display:    'inline-flex',
      alignItems: 'center',
      height:     44,
      flexShrink: 0,
      maxWidth:   160,
      cursor:     'pointer',
    }}>
      <span
        title={`Categoria: ${hasCategory ? trimmed : 'não definida'}${showWarning ? ' (a confirmar)' : ''}`}
        style={{
          display:       'inline-flex',
          alignItems:    'center',
          gap:           6,
          padding:       '0 10px',
          height:        '100%',
          background:    'transparent',
          border:        showWarning  ? '1px dashed var(--warning)'
                       : !hasCategory ? '1px dashed var(--border)'
                                       : 'none',
          borderRadius:  6,
          fontSize:      12,
          fontWeight:    500,
          color:         'var(--text-muted)',
          maxWidth:      220,
          overflow:      'hidden',
          textOverflow:  'ellipsis',
          whiteSpace:    'nowrap',
          pointerEvents: 'none',
        }}
      >
        <span style={{
          fontSize:      10,
          fontWeight:    700,
          letterSpacing: '0.04em',
          color:         'var(--text-subtle)',
          flexShrink:    0,
        }}>Cat.</span>
        <span style={{
          color:        showWarning ? 'var(--warning)' : 'var(--text)',
          fontStyle:    hasCategory ? 'normal' : 'italic',
          fontWeight:   hasCategory ? 600 : 500,
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}>{display}</span>
        <span style={{
          fontSize:   10,
          color:      'var(--text-subtle)',
          flexShrink: 0,
        }}>▾</span>
      </span>
      <select
        value={hasCategory ? trimmed : ''}
        onChange={e => onChange(e.target.value)}
        aria-label="Categoria"
        style={{
          position:   'absolute',
          inset:      0,
          width:      '100%',
          height:     '100%',
          opacity:    0,
          cursor:     'pointer',
          appearance: 'none',
          WebkitAppearance: 'none',
          border:     'none',
          background: 'transparent',
          fontSize:   16, // evita zoom iOS no focus
        }}
      >
        <option value="">— sem categoria —</option>
        {extraOptions.map(c => (
          <option key={c} value={c}>{c}</option>
        ))}
        {ARTICLE_CATEGORIES.map(c => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  )
}
