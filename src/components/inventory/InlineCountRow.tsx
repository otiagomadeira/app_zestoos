'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CurrentStock } from '@/types/database'
import { useArticleAutosave, type AutosaveStatus } from '@/lib/inventory/useArticleAutosave'

interface InlineCountRowProps {
  article:    CurrentStock
  sessionId:  string | null
  isCounted:  boolean
  isSkipped:  boolean
  onCounted:  (articleId: string) => void
  onSkip:     (articleId: string) => void
}

// Threshold em pixels do container abaixo do qual usamos layout 2-linhas.
// Ajustado para que a maioria dos telemóveis em portrait caia em compacto
// (estes têm 320–430px de viewport, ~290–400px de container útil) e os
// tablets/desktops fiquem em single-line. Dimensionado pela largura
// efectiva do card, não pela viewport — assim funciona com sidebars,
// split-view, etc.
const COMPACT_BREAKPOINT_PX = 420

// Insere espaço entre dígito-letra e letra-dígito em labels colados
// (igual ao ArticleCard: "saco25kg" → "saco 25 kg", "1000mL" → "1000 mL").
function spaceDigitsAndLetters(s: string): string {
  return s
    .replace(/([a-zA-Zµ])(\d)/g, '$1 $2')
    .replace(/(\d)\s*([a-zA-Zµ])/g, '$1 $2')
}

// Display da unidade na linha inline:
//   - "un solto"   → "Unidade"
//   - "<X> solto"  → "A granel · <X>"        (nunca deixar o chef sem unidade)
//   - supplier/size → spaceDigitsAndLetters("kg" → "kg", "1000mL" → "1000 mL")
function formatUnitLabel(label: string): string {
  const m = label.match(/^(.+) solto$/i)
  if (m) {
    const base = m[1]
    if (base.toLowerCase() === 'un') return 'Unidade'
    return `A granel · ${base}`
  }
  return spaceDigitsAndLetters(label)
}

// current_qty (em base_unit) → string em packaging units para o input.
// 0 ou ~0 → '' (placeholder "0" do input toma conta do display).
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
 * Layout responsivo (sem detectar dispositivo — só largura do container):
 *
 *   ≥ 420px (tablet/desktop, telemóvel grande):
 *     [Nome] [-] [qty] [+] [unidade] [status] [⋯]
 *
 *   < 420px (telemóvel pequeno/médio):
 *     Linha 1: [Nome ───────] [status] [⋯]
 *     Linha 2: [-] [qty] [+] [unidade]
 *
 * Threshold escolhido para que a stepper (≈150px) + unit (≈80px) +
 * status (22px) + ⋯ (44px) + nome legível (≥120px) caibam confortavelmente.
 *
 * Default SSR: layout compacto (mobile-first). No mount, ResizeObserver
 * mede a largura real e troca para wide se for o caso. Flicker breve
 * em desktop só na primeira render — aceitável.
 *
 * Tudo o resto (autosave, status, contar depois, etc.) idêntico à versão
 * anterior. Sem detecção de iOS/Android. Sem rgba — só tokens CSS.
 */
export default function InlineCountRow({
  article,
  sessionId,
  isCounted,
  isSkipped,
  onCounted,
  onSkip,
}: InlineCountRowProps) {
  const basePerUnit = article.single_packaging_base_per_unit ?? 1
  const label       = article.single_packaging_label ?? ''
  const unitDisplay = formatUnitLabel(label)
  const initialQty  = formatInitialQty(article.current_qty, basePerUnit)

  // onSaved estável via ref — evita re-criar o hook em cada render do parent
  // (que passa `() => addCounted(...)` recriado a cada render).
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

  const [menuOpen, setMenuOpen] = useState<boolean>(false)

  // Layout responsivo: mede o próprio container.
  // Mobile-first: SSR começa em compacto.
  const containerRef = useRef<HTMLDivElement>(null)
  const [layoutWide, setLayoutWide] = useState<boolean>(false)
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0
      setLayoutWide(w >= COMPACT_BREAKPOINT_PX)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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

  const handleSkipClick = useCallback(() => {
    setMenuOpen(false)
    onSkip(article.article_id)
  }, [onSkip, article.article_id])

  // ✓ persistente de "contado nesta sessão" só em idle — StatusIcon cobre o resto.
  const showCountedTick = isCounted && status === 'idle'

  const nameRow = (
    <div style={{
      display:    'flex',
      alignItems: 'center',
      gap:        6,
      flex:       layoutWide ? '1 1 0' : '1 1 100%',
      minWidth:   0,
    }}>
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
        <span aria-label="Contado nesta sessão" style={{ fontSize: 13, color: 'var(--success)', fontWeight: 700, flexShrink: 0 }}>✓</span>
      )}
      {isSkipped && !isCounted && (
        <span
          aria-label="Marcado para contar depois"
          style={{ fontSize: 11, color: 'var(--text-subtle)', fontWeight: 500, flexShrink: 0 }}
        >depois</span>
      )}
      <StatusIcon status={status} error={error} onActivate={handleStatusActivate} />
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setMenuOpen(o => !o)}
          disabled={controlsDisabled}
          aria-label="Mais opções"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          style={{
            width:          44,
            height:         44,
            borderRadius:   8,
            border:         'none',
            background:     'transparent',
            color:          'var(--text-muted)',
            fontSize:       22,
            fontWeight:     700,
            lineHeight:     1,
            cursor:         controlsDisabled ? 'not-allowed' : 'pointer',
            opacity:        controlsDisabled ? 0.5 : 1,
            touchAction:    'manipulation',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
          }}
        >⋯</button>
        {menuOpen && (
          <>
            <div
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
              style={{ position: 'fixed', inset: 0, zIndex: 50 }}
            />
            <div
              role="menu"
              style={{
                position:     'absolute',
                top:          50,
                right:        0,
                background:   'var(--surface-2)',
                border:       '1px solid var(--border)',
                borderRadius: 8,
                minWidth:     160,
                zIndex:       51,
                overflow:     'hidden',
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={handleSkipClick}
                style={{
                  width:      '100%',
                  minHeight:  44,
                  padding:    '10px 14px',
                  background: 'transparent',
                  border:     'none',
                  color:      'var(--text)',
                  fontSize:   14,
                  fontWeight: 500,
                  textAlign:  'left',
                  cursor:     'pointer',
                }}
              >
                Contar depois
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  const stepperRow = (
    <div style={{
      display:        'flex',
      alignItems:     'center',
      gap:            6,
      flex:           layoutWide ? '0 0 auto' : '1 1 100%',
      justifyContent: layoutWide ? 'flex-end' : 'flex-end',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <button
          type="button"
          onClick={handleMinus}
          disabled={minusDisabled}
          aria-label={`Diminuir ${article.name}`}
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
            opacity:        minusDisabled ? 0.5 : 1,
            touchAction:    'manipulation',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
          }}
        >−</button>
        <input
          type="text"
          inputMode="decimal"
          pattern="[0-9]*[.,]?[0-9]*"
          value={qty}
          onChange={(e) => handleInputChange(e.target.value)}
          onBlur={handleInputBlur}
          placeholder="0"
          disabled={controlsDisabled}
          aria-label={`Quantidade de ${article.name}`}
          style={{
            width:        50,
            height:       44,
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
          }}
        />
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
      <span style={{
        fontSize:    11,
        color:       'var(--text-muted)',
        whiteSpace:  'nowrap',
        flexShrink:  0,
        marginLeft:  2,
      }}>
        {unitDisplay}
      </span>
    </div>
  )

  return (
    <div
      ref={containerRef}
      style={{
        width:        '100%',
        background:   'var(--surface)',
        border:       '1px solid var(--border)',
        borderRadius: 12,
        padding:      '8px 8px 8px 14px',
        minHeight:    64,
        display:      'flex',
        flexWrap:     'wrap',
        alignItems:   'center',
        gap:          6,
        rowGap:       layoutWide ? 0 : 8,
      }}
    >
      {nameRow}
      {stepperRow}
    </div>
  )
}

interface StatusIconProps {
  status:     AutosaveStatus
  error:      string | null
  onActivate: () => void
}

function StatusIcon({ status, error, onActivate }: StatusIconProps) {
  // Spacer fixo para layout estável (status muda sem deslocar elementos).
  const containerStyle: React.CSSProperties = {
    width:          22,
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
          marginLeft:  -11,
          marginRight: -11,
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
  // idle
  return <span aria-hidden="true" style={containerStyle} />
}
