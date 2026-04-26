'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { CurrentStock } from '@/types/database'
import { useArticleAutosave, type AutosaveStatus } from '@/lib/inventory/useArticleAutosave'
import { formatPackagingLabel } from '@/lib/inventory/formatPackagingLabel'

interface InlineCountRowProps {
  article:    CurrentStock
  sessionId:  string | null
  isCounted:  boolean
  onCounted:  (articleId: string) => void
}

// current_qty (em base_unit) → string em packaging units para o input.
// Usado APENAS quando isCounted=true; current_qty da DB já reflecte a contagem
// desta sessão. 0 ou ~0 → '' (placeholder "0" toma conta do display).
function formatInitialQty(currentQty: number, basePerUnit: number): string {
  if (basePerUnit <= 0) return ''
  const qty = currentQty / basePerUnit
  if (Math.abs(qty) < 0.0001) return ''
  return (+(qty.toFixed(2))).toString().replace('.', ',')
}

// Step utilitário: ajusta qty (string) por delta, sem ir abaixo de 0.
// Vazio quando resultado === 0 (deixa o placeholder do input visível).
function stepQty(current: string, delta: number): string {
  const parsed = parseFloat((current || '0').replace(',', '.'))
  const base   = isNaN(parsed) ? 0 : parsed
  const next   = Math.max(0, base + delta)
  if (Math.abs(next) < 0.0001) return ''
  return Number.isInteger(next) ? String(next) : String(next).replace('.', ',')
}

/**
 * Linha de contagem inline para artigos com 1 única embalagem.
 *
 * Layout sempre single-line:
 *   [Nome ──── ✓?] [status] [-] [qty] [+] [unidade]
 *
 * Regra do placeholder/value (decisão de produto):
 *   - !isCounted → input vazio + placeholder "—" (current_qty da DB é
 *     ignorado mesmo que > 0; o campo representa esta sessão, não stock antigo)
 *   - isCounted, qty=0 → input vazio + placeholder "0"
 *   - isCounted, qty>0 → input mostra valor formatado
 *
 * O current_qty serve apenas como baseline interno do RPC (cálculo do
 * ADJUSTMENT a partir do delta), nunca alimenta o display directamente.
 */
export default function InlineCountRow({
  article,
  sessionId,
  isCounted,
  onCounted,
}: InlineCountRowProps) {
  const basePerUnit = article.single_packaging_base_per_unit ?? 1
  const label       = article.single_packaging_label ?? ''
  const unitDisplay = formatPackagingLabel(label, basePerUnit, article.unit)
  // initialQty só é populado se já contado nesta sessão. Caso contrário, vazio
  // — o placeholder "—" comunica "ainda não contado".
  const initialQty  = isCounted ? formatInitialQty(article.current_qty, basePerUnit) : ''
  const placeholder = isCounted ? '0' : '—'

  // onSaved estável via ref — evita re-criar o hook em cada render do parent.
  const onSavedRef = useRef<() => void>(() => onCounted(article.article_id))
  useEffect(() => {
    onSavedRef.current = () => onCounted(article.article_id)
  }, [onCounted, article.article_id])

  const { qty, status, error, setQty, flush, retry } = useArticleAutosave({
    articleId:  article.article_id,
    sessionId,
    initialQty,
    onSaved:    () => onSavedRef.current(),
  })

  const isReady          = sessionId !== null
  const parsedQty        = parseFloat((qty || '0').replace(',', '.'))
  const isAtZero         = qty.trim() === '' || (Number.isFinite(parsedQty) && parsedQty <= 0)
  const minusDisabled    = !isReady || isAtZero || status === 'saving'
  const controlsDisabled = !isReady

  const handleMinus = useCallback(() => {
    if (minusDisabled) return
    setQty(stepQty(qty, -1))
  }, [minusDisabled, qty, setQty])

  const handlePlus = useCallback(() => {
    if (controlsDisabled) return
    setQty(stepQty(qty, +1))
  }, [controlsDisabled, qty, setQty])

  const handleInputChange = useCallback((raw: string) => {
    setQty(raw)
  }, [setQty])

  const handleInputBlur = useCallback(() => {
    void flush()
  }, [flush])

  const handleStatusActivate = useCallback(() => {
    if (status === 'error') void retry()
  }, [status, retry])

  // ✓ persistente quando contado e sem operação em curso (status idle).
  // Durante saving/saved/dirty/error o StatusIcon comunica o estado.
  const showCountedTick = isCounted && status === 'idle'

  return (
    <div
      style={{
        width:        '100%',
        background:   'var(--surface)',
        border:       '1px solid var(--border)',
        borderRadius: 10,
        padding:      '6px 8px 6px 12px',
        minHeight:    56,
        display:      'flex',
        alignItems:   'center',
        gap:          6,
      }}
    >
      <span style={{
        fontSize:     15,
        fontWeight:   600,
        color:        'var(--text)',
        whiteSpace:   'nowrap',
        overflow:     'hidden',
        textOverflow: 'ellipsis',
        flex:         1,
        minWidth:     0,
      }}>
        {article.name}
      </span>
      {showCountedTick && (
        <span
          aria-label="Contado nesta sessão"
          style={{ fontSize: 13, color: 'var(--success)', fontWeight: 700, flexShrink: 0 }}
        >
          ✓
        </span>
      )}
      <StatusIcon status={status} error={error} onActivate={handleStatusActivate} />

      <span style={{
        fontSize:     12,
        color:        'var(--text-muted)',
        whiteSpace:   'nowrap',
        flexShrink:   0,
        // Unit antes do stepper → o stepper fica sempre encostado à direita,
        // logo os botões `+` ficam alinhados entre todos os cards. Largura
        // natural; maxWidth defensivo para labels patológicas.
        maxWidth:     140,
        overflow:     'hidden',
        textOverflow: 'ellipsis',
        textAlign:    'right',
      }}>
        {unitDisplay}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <button
          type="button"
          onClick={handleMinus}
          disabled={minusDisabled}
          aria-label={`Diminuir ${article.name}`}
          // Sempre visível para manter a caixa do input claramente identificável
          // entre dois botões. Desabilita-se com cursor/opacity quando não há
          // valor para subtrair — não mais oculto via visibility.
          style={{
            width:          44,
            height:         44,
            borderRadius:   8,
            border:         '1px solid var(--border)',
            background:     'var(--surface-2)',
            color:          minusDisabled ? 'var(--text-subtle)' : 'var(--text)',
            fontSize:       20,
            fontWeight:     700,
            lineHeight:     1,
            cursor:         minusDisabled ? 'not-allowed' : 'pointer',
            opacity:        minusDisabled ? 0.4 : 1,
            touchAction:    'manipulation',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
          }}
        >−</button>
        <div style={{ position: 'relative', width: 64, height: 44, flexShrink: 0 }}>
          <input
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[.,]?[0-9]*"
            value={qty}
            onChange={(e) => handleInputChange(e.target.value)}
            onBlur={handleInputBlur}
            // Placeholder próprio via overlay — placeholder nativo demasiado
            // subtil (opacidade default do browser) tornava a caixa invisível.
            placeholder=""
            disabled={controlsDisabled}
            aria-label={`Quantidade de ${article.name}`}
            style={{
              width:        '100%',
              height:       '100%',
              background:   'var(--bg)',
              border:       '1px solid var(--border)',
              borderRadius: 8,
              color:        'var(--text)',
              fontFamily:   'var(--font-mono), monospace',
              fontSize:     17,
              fontWeight:   700,
              textAlign:    'center',
              padding:      '0 6px',
              outline:      'none',
              opacity:      controlsDisabled ? 0.5 : 1,
              boxSizing:    'border-box',
            }}
          />
          {qty.trim() === '' && (
            <span
              aria-hidden="true"
              style={{
                position:       'absolute',
                inset:          0,
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                pointerEvents:  'none',
                color:          'var(--text-subtle)',
                fontFamily:     'var(--font-mono), monospace',
                fontSize:       16,
                fontWeight:     500,
              }}
            >
              {placeholder}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handlePlus}
          disabled={controlsDisabled}
          aria-label={`Aumentar ${article.name}`}
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
            cursor:         controlsDisabled ? 'not-allowed' : 'pointer',
            opacity:        controlsDisabled ? 0.5 : 1,
            touchAction:    'manipulation',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
          }}
        >+</button>
      </div>
    </div>
  )
}

interface StatusIconProps {
  status:     AutosaveStatus
  error:      string | null
  onActivate: () => void
}

function StatusIcon({ status, error, onActivate }: StatusIconProps) {
  const containerStyle: React.CSSProperties = {
    width:          18,
    height:         22,
    flexShrink:     0,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    fontWeight:     700,
    lineHeight:     1,
  }
  if (status === 'saving' || status === 'dirty') {
    return (
      <span aria-label="A guardar" aria-live="polite" style={{ ...containerStyle, color: 'var(--text-subtle)', fontSize: 14 }}>
        …
      </span>
    )
  }
  if (status === 'saved') {
    return (
      <span aria-label="Guardado" aria-live="polite" style={{ ...containerStyle, color: 'var(--success)', fontSize: 16 }}>
        ✓
      </span>
    )
  }
  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={onActivate}
        aria-label={`Erro a guardar${error ? `: ${error}` : ''}. Toca para tentar de novo.`}
        style={{
          ...containerStyle,
          width:        44,
          height:       44,
          marginLeft:  -13,
          marginRight: -13,
          borderRadius: 6,
          border:       'none',
          background:   'transparent',
          color:        'var(--error)',
          fontSize:     18,
          cursor:       'pointer',
          touchAction:  'manipulation',
        }}
      >
        !
      </button>
    )
  }
  return <span aria-hidden="true" style={containerStyle} />
}
