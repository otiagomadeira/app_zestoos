'use client'

import { formatStockQty } from '@/lib/units'

export type NumpadProps = {
  articleName: string
  currentQty:  number
  unit:        string
  value:       string
  /** true durante save em curso — desativa OK e mostra "…" */
  saving?:     boolean
  onDigit:     (d: string) => void
  onDecimal:   () => void
  onBackspace: () => void
  onOk:        () => void
  onSkip?:     () => void
  onClose:     () => void
}

/**
 * Numpad — bottom-sheet visual puro para contagem de stock.
 *
 * Sem <input>: nenhum botão acciona teclado nativo do iOS/Android.
 * Componente controlado: o `value` (string) vem de fora.
 * Parsing é responsabilidade do chamador.
 *
 * Layout:
 *   [backdrop click → onClose]
 *   ┌──────────────────────────────────┐
 *   │ articleName                  [×] │
 *   │ atual: X unit                    │
 *   │                                  │
 *   │              VALUE  unit         │   ← display grande
 *   │                                  │
 *   │  [7] [8] [9]                     │
 *   │  [4] [5] [6]                     │
 *   │  [1] [2] [3]                     │
 *   │  [.] [0] [⌫]                     │
 *   │                                  │
 *   │  [ marcar como contado ]         │   ← opcional
 *   │  [        OK               ]     │
 *   └──────────────────────────────────┘
 */
export default function Numpad({
  articleName,
  currentQty,
  unit,
  value,
  saving = false,
  onDigit,
  onDecimal,
  onBackspace,
  onOk,
  onSkip,
  onClose,
}: NumpadProps) {
  // preventDefault em pointerDown evita que qualquer <input> atrás roube focus
  // e evita que o iOS reabra o teclado nativo durante a contagem.
  const press = (fn: () => void) => (e: React.PointerEvent) => {
    e.preventDefault()
    fn()
  }

  const digits: Array<'7' | '8' | '9' | '4' | '5' | '6' | '1' | '2' | '3' | '0'> =
    ['7', '8', '9', '4', '5', '6', '1', '2', '3']

  return (
    <>
      {/* Backdrop */}
      <div
        onPointerDown={press(onClose)}
        aria-hidden="true"
        style={{
          position:  'fixed',
          inset:     0,
          background: 'rgba(28, 20, 10, 0.35)',
          zIndex:    50,
          // permite que o sheet por baixo receba pointer events normalmente
          touchAction: 'none',
        }}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-label={`Contagem de ${articleName}`}
        aria-modal="true"
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position:      'fixed',
          left:          0,
          right:         0,
          bottom:        0,
          zIndex:        51,
          background:    'var(--primary)',
          color:         'var(--text-on-primary)',
          borderTopLeftRadius:  20,
          borderTopRightRadius: 20,
          boxShadow:     '0 -8px 24px rgba(0,0,0,0.25)',
          paddingTop:    16,
          paddingLeft:   16,
          paddingRight:  16,
          paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
          display:       'flex',
          flexDirection: 'column',
          gap:           12,
          maxHeight:     '85vh',
        }}
      >
        {/* Drag handle (decorativo) */}
        <div
          aria-hidden="true"
          style={{
            width:        40,
            height:       4,
            borderRadius: 2,
            background:   'var(--border-on-primary-medium)',
            alignSelf:    'center',
            marginTop:    -8,
            marginBottom: 4,
          }}
        />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontSize:     18,
                fontWeight:   700,
                color:        'var(--text-on-primary)',
                whiteSpace:   'nowrap',
                overflow:     'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {articleName}
            </p>
            <p
              style={{
                fontSize: 13,
                color:    'var(--text-on-primary-muted)',
                marginTop: 2,
              }}
            >
              atual:{' '}
              <span style={{ fontFamily: 'var(--font-mono), monospace' }}>
                {formatStockQty(currentQty, unit)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onPointerDown={press(onClose)}
            aria-label="Fechar"
            style={{
              width:          44,
              height:         44,
              borderRadius:   12,
              border:         '1px solid var(--border-on-primary)',
              background:     'transparent',
              color:          'var(--text-on-primary)',
              fontSize:       22,
              lineHeight:     1,
              cursor:         'pointer',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              flexShrink:     0,
            }}
          >
            ×
          </button>
        </div>

        {/* Display */}
        <div
          aria-live="polite"
          aria-label={`Valor a contar: ${value || '0'} ${unit}`}
          style={{
            display:        'flex',
            alignItems:     'baseline',
            justifyContent: 'flex-end',
            gap:            10,
            background:     'rgba(0,0,0,0.18)',
            border:         '1px solid var(--border-on-primary)',
            borderRadius:   12,
            padding:        '14px 18px',
            minHeight:      72,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono), monospace',
              fontSize:   48,
              fontWeight: 700,
              lineHeight: 1,
              color:      value ? 'var(--text-on-primary)' : 'var(--text-on-primary-faint)',
              letterSpacing: '-0.02em',
            }}
          >
            {value || '0'}
          </span>
          <span
            style={{
              fontSize:   18,
              color:      'var(--text-on-primary-muted)',
              fontWeight: 600,
            }}
          >
            {unit}
          </span>
        </div>

        {/* Grid 3×4 */}
        <div
          style={{
            display:             'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap:                 8,
          }}
        >
          {digits.map((d) => (
            <NumpadKey
              key={d}
              label={d}
              ariaLabel={`Dígito ${d}`}
              onPress={() => onDigit(d)}
            />
          ))}

          <NumpadKey
            label="."
            ariaLabel="Ponto decimal"
            onPress={onDecimal}
            variant="muted"
          />
          <NumpadKey
            label="0"
            ariaLabel="Dígito 0"
            onPress={() => onDigit('0')}
          />
          <NumpadKey
            label="⌫"
            ariaLabel="Apagar último dígito"
            onPress={onBackspace}
            variant="muted"
          />
        </div>

        {/* Skip (opcional) */}
        {onSkip && (
          <button
            type="button"
            onPointerDown={press(onSkip)}
            style={{
              background:    'transparent',
              border:        'none',
              color:         'var(--text-on-primary-muted)',
              fontSize:      13,
              padding:       '6px 0',
              cursor:        'pointer',
              textDecoration: 'underline',
              alignSelf:     'center',
            }}
          >
            marcar como contado sem alterar
          </button>
        )}

        {/* OK */}
        <button
          type="button"
          onPointerDown={saving ? (e) => e.preventDefault() : press(onOk)}
          disabled={saving}
          aria-label="Confirmar contagem"
          aria-busy={saving}
          style={{
            width:          '100%',
            minHeight:      64,
            borderRadius:   14,
            border:         'none',
            background:     saving ? 'var(--action-disabled)' : 'var(--action)',
            color:          'var(--white)',
            fontSize:       20,
            fontWeight:     700,
            letterSpacing:  '0.02em',
            cursor:         saving ? 'wait' : 'pointer',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
          }}
        >
          {saving ? '…' : 'OK'}
        </button>
      </div>
    </>
  )
}

/* ────────────────────────────────────────────────────────────── */
/*  Tecla individual                                              */
/* ────────────────────────────────────────────────────────────── */

type KeyVariant = 'default' | 'muted'

function NumpadKey({
  label,
  ariaLabel,
  onPress,
  variant = 'default',
}: {
  label:     string
  ariaLabel: string
  onPress:   () => void
  variant?:  KeyVariant
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => { e.preventDefault(); onPress() }}
      aria-label={ariaLabel}
      style={{
        height:         60,
        minWidth:       56,
        borderRadius:   12,
        border:         '1px solid var(--border-on-primary)',
        background:     variant === 'muted'
          ? 'rgba(0,0,0,0.10)'
          : 'rgba(255,255,255,0.06)',
        color:          'var(--text-on-primary)',
        fontFamily:     'var(--font-mono), monospace',
        fontSize:       24,
        fontWeight:     600,
        cursor:         'pointer',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        userSelect:     'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    >
      {label}
    </button>
  )
}
