'use client'

import { useState, useMemo, useCallback } from 'react'
import type { Packaging, CountLine } from '@/lib/stockCount'
import { packagingKey } from '@/lib/stockCount'
import { formatBaseQty } from '@/lib/units'

export type CountSheetProps = {
  articleName: string
  baseUnit:    string
  currentQty:  number          // em baseUnit (vem da view)
  packagings:  Packaging[] | null  // null = ainda a carregar
  saving?:     boolean
  onClose:     () => void
  onSkip:      () => void
  onSave:      (lines: CountLine[]) => void
}

// Aceita "1,5" ou "1.5" — devolve NaN se inválido.
function parseQty(raw: string): number {
  const n = parseFloat(raw.replace(',', '.'))
  return isNaN(n) ? NaN : n
}

// Insere espaço entre dígito-letra e letra-dígito em labels colados
// ("saco25kg" → "saco 25 kg", "5L" → "5 L", "200g" → "200 g") sem
// alterar labels já bem espaçados.
function spaceDigitsAndLetters(s: string): string {
  return s
    .replace(/([a-zA-Zµ])(\d)/g, '$1 $2')
    .replace(/(\d)\s*([a-zA-Zµ])/g, '$1 $2')
}

// Display da label da embalagem com a conversão visível quando o label
// está incompleto (ex.: "caixa" sem dígito → "caixa 5 kg").
// - fallback: tal e qual ("kg solto", "L solto")
// - tem dígito: normaliza espaços ("saco 25kg" → "saco 25 kg")
// - sem dígito: anexa formatBaseQty(base_per_unit, baseUnit)
function formatPackagingLabel(p: Packaging, baseUnit: string): string {
  if (p.source === 'fallback') return p.label
  if (/\d/.test(p.label))      return spaceDigitsAndLetters(p.label)
  return `${p.label} ${formatBaseQty(p.base_per_unit, baseUnit)}`
}

/**
 * CountSheet — bottom-sheet de contagem multi-embalagem.
 *
 * Cada linha tem o seu próprio <input inputMode="decimal">. O total agregado
 * em base_unit é mostrado discreto junto ao Guardar. Não há numpad interno:
 * em iOS o inputMode="decimal" abre apenas teclado numérico.
 */
export default function CountSheet({
  articleName,
  baseUnit,
  currentQty,
  packagings,
  saving = false,
  onClose,
  onSkip,
  onSave,
}: CountSheetProps) {
  // String por linha — preserva "0,", "1.", input parcial.
  const [qtys, setQtys] = useState<Record<string, string>>({})

  const total = useMemo(() => {
    if (!packagings) return 0
    return packagings.reduce((sum, p) => {
      const n = parseQty(qtys[packagingKey(p)] ?? '')
      if (isNaN(n) || n <= 0) return sum
      return sum + n * p.base_per_unit
    }, 0)
  }, [packagings, qtys])

  const hasAnyValue = useMemo(
    () => Object.values(qtys).some(v => parseQty(v) > 0),
    [qtys],
  )

  // Guardar disabled quando: a guardar; ou (total=0 AND stock atual já era 0).
  // Permite-se total=0 com currentQty>0 (intenção "esgotei o artigo") com confirmação.
  const saveDisabled = saving || (total === 0 && currentQty === 0)

  const handleClose = useCallback(() => {
    if (!hasAnyValue) { onClose(); return }
    if (typeof window !== 'undefined' && window.confirm('Descartar contagem?')) onClose()
  }, [hasAnyValue, onClose])

  const handleSave = useCallback(() => {
    if (!packagings) return
    const lines: CountLine[] = packagings
      .map(p => {
        const n = parseQty(qtys[packagingKey(p)] ?? '')
        return { label: p.label, qty: isNaN(n) ? 0 : n, base_per_unit: p.base_per_unit }
      })
      .filter(l => l.qty > 0)

    if (lines.length === 0) {
      // Esgotar stock: confirma só quando há stock anterior.
      if (currentQty > 0) {
        if (typeof window === 'undefined' || !window.confirm('Esgotaste este artigo? O stock vai a 0.')) return
        onSave([{ label: 'esgotado', qty: 0, base_per_unit: 1 }])
      }
      return
    }
    onSave(lines)
  }, [packagings, qtys, currentQty, onSave])

  const setQty = (key: string, raw: string) => {
    // Aceita só dígitos, vírgula e ponto. Limita comprimento sensato.
    const cleaned = raw.replace(/[^\d.,]/g, '').slice(0, 8)
    setQtys(prev => ({ ...prev, [key]: cleaned }))
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onPointerDown={(e) => { e.preventDefault(); handleClose() }}
        aria-hidden="true"
        style={{
          position:    'fixed',
          inset:       0,
          background:  'rgba(28, 20, 10, 0.35)',
          zIndex:      50,
          touchAction: 'none',
        }}
      />

      {/* Sheet — fixed bottom, max 480px, centrado em desktop */}
      <div
        role="dialog"
        aria-label={`Contagem de ${articleName}`}
        aria-modal="true"
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position:             'fixed',
          left:                 0,
          right:                0,
          bottom:               0,
          marginLeft:           'auto',
          marginRight:          'auto',
          maxWidth:             480,
          width:                '100%',
          zIndex:               51,
          background:           'var(--primary)',
          color:                'var(--text-on-primary)',
          borderTopLeftRadius:  20,
          borderTopRightRadius: 20,
          boxShadow:            '0 -8px 24px rgba(0,0,0,0.25)',
          paddingTop:           14,
          paddingLeft:          16,
          paddingRight:         16,
          paddingBottom:        'max(14px, env(safe-area-inset-bottom))',
          display:              'flex',
          flexDirection:        'column',
          gap:                  12,
          maxHeight:            '85vh',
        }}
      >
        {/* Drag handle */}
        <div
          aria-hidden="true"
          style={{
            width:        40,
            height:       4,
            borderRadius: 2,
            background:   'var(--border-on-primary-medium)',
            alignSelf:    'center',
            marginTop:    -6,
            marginBottom: 2,
          }}
        />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize:     17,
              fontWeight:   700,
              color:        'var(--text-on-primary)',
              whiteSpace:   'nowrap',
              overflow:     'hidden',
              textOverflow: 'ellipsis',
            }}>
              {articleName}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-on-primary-muted)', marginTop: 2 }}>
              atual:{' '}
              <span style={{ fontFamily: 'var(--font-mono), monospace' }}>
                {formatBaseQty(currentQty, baseUnit)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
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

        {/* Lista de linhas */}
        <div style={{
          display:       'flex',
          flexDirection: 'column',
          gap:           8,
          overflowY:     'auto',
          minHeight:     0,
          flex:          '0 1 auto',
        }}>
          {packagings === null && (
            <p style={{ fontSize: 13, color: 'var(--text-on-primary-muted)', textAlign: 'center', padding: 20 }}>
              A carregar embalagens…
            </p>
          )}
          {packagings && packagings.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-on-primary-muted)', textAlign: 'center', padding: 20 }}>
              Sem embalagens disponíveis.
            </p>
          )}
          {packagings && packagings.map((p) => {
            const key   = packagingKey(p)
            const label = formatPackagingLabel(p, baseUnit)
            const value = qtys[key] ?? ''
            return (
              <label
                key={key}
                style={{
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'space-between',
                  gap:            10,
                  minHeight:      48,
                  padding:        '0 12px 0 14px',
                  borderRadius:   10,
                  border:         '1px solid var(--border-on-primary)',
                  background:     'rgba(255,255,255,0.04)',
                }}
              >
                <span style={{
                  fontSize:     14,
                  fontWeight:   500,
                  color:        'var(--text-on-primary)',
                  whiteSpace:   'nowrap',
                  overflow:     'hidden',
                  textOverflow: 'ellipsis',
                  flex:         1,
                  minWidth:     0,
                }}>
                  {label}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9]*[.,]?[0-9]*"
                  value={value}
                  onChange={(e) => setQty(key, e.target.value)}
                  placeholder="0"
                  aria-label={`Quantidade de ${label}`}
                  style={{
                    width:        72,
                    height:       44,
                    background:   'rgba(0,0,0,0.18)',
                    border:       '1px solid var(--border-on-primary)',
                    borderRadius: 8,
                    color:        'var(--text-on-primary)',
                    fontFamily:   'var(--font-mono), monospace',
                    fontSize:     18,
                    fontWeight:   700,
                    textAlign:    'right',
                    padding:      '0 10px',
                    outline:      'none',
                  }}
                />
              </label>
            )
          })}
        </div>

        {/* Total — discreto, junto ao Guardar */}
        <div
          aria-live="polite"
          style={{
            display:        'flex',
            alignItems:     'baseline',
            justifyContent: 'space-between',
            paddingTop:     2,
            paddingBottom:  2,
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-on-primary-muted)' }}>
            Total contado
          </span>
          <span style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize:   16,
            fontWeight: 700,
            color:      total > 0 ? 'var(--text-on-primary)' : 'var(--text-on-primary-faint)',
          }}>
            {formatBaseQty(total, baseUnit)}
          </span>
        </div>

        {/* Acções */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Contar depois"
            style={{
              flex:         1,
              minHeight:    52,
              borderRadius: 12,
              border:       '1px solid var(--border-on-primary)',
              background:   'transparent',
              color:        'var(--text-on-primary-muted)',
              fontSize:     14,
              fontWeight:   600,
              cursor:       'pointer',
            }}
          >
            Contar depois
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saveDisabled}
            aria-label="Guardar contagem"
            aria-busy={saving}
            style={{
              flex:         2,
              minHeight:    52,
              borderRadius: 12,
              border:       'none',
              background:   saveDisabled ? 'var(--action-disabled)' : 'var(--action)',
              color:        'var(--white)',
              fontSize:     17,
              fontWeight:   700,
              cursor:       saveDisabled ? 'not-allowed' : 'pointer',
              opacity:      saveDisabled && !saving ? 0.6 : 1,
            }}
          >
            {saving ? '…' : 'Guardar'}
          </button>
        </div>
      </div>
    </>
  )
}
