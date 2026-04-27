'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { CurrentStock } from '@/types/database'
import type { Packaging } from '@/lib/stockCount'
import { packagingKey } from '@/lib/stockCount'
import { formatBaseQty } from '@/lib/units'
import { formatPackagingLabel } from '@/lib/inventory/formatPackagingLabel'
import {
  useMultiPackagingAutosave,
  type MultiAutosaveStatus,
} from '@/lib/inventory/useMultiPackagingAutosave'
import PackagingLine from './PackagingLine'
import InlineCountRow from './InlineCountRow'

interface ArticleCardProps {
  article:    CurrentStock
  isExpanded: boolean
  packagings: Packaging[] | null
  isCounted:  boolean
  sessionId:  string | null
  onToggle:   () => void
  onCounted:  (articleId: string) => void
}

export default function ArticleCard({
  article,
  isExpanded,
  packagings,
  isCounted,
  sessionId,
  onToggle,
  onCounted,
}: ArticleCardProps) {
  const isSimpleInline =
    article.packaging_count === 1 &&
    article.single_packaging_label !== null &&
    article.single_packaging_base_per_unit !== null

  // Derivado de current_stock view (sempre disponível, mesmo colapsado).
  // Antes era derivado de `packagings` (carregado só ao expandir), o que
  // fazia o badge MULTI desaparecer no estado colapsado e tornava o card
  // visualmente indistinguível de uma linha vazia.
  const isMulti = article.packaging_count > 1

  // Ref que aponta para a flush() do hook do ExpandedBody. Permite ao
  // header forçar save antes de colapsar (fire-and-forget).
  const flushPendingRef = useRef<(() => Promise<void>) | null>(null)

  const handleHeaderClick = useCallback(() => {
    if (isExpanded && flushPendingRef.current) {
      void flushPendingRef.current()
    }
    onToggle()
  }, [isExpanded, onToggle])

  if (isSimpleInline) {
    return (
      <InlineCountRow
        article={article}
        sessionId={sessionId}
        isCounted={isCounted}
        onCounted={onCounted}
      />
    )
  }

  // role="button" em <div> em vez de <button> nativo. iOS Safari aplica UA
  // styles ao <button> que ignoram min-height quando o conteúdo é flex+wrap
  // — resultado visível: cards multi colapsavam para ~24px (linha fina).
  // O <div> aceita display:flex sem reservas e o role+tabIndex+keydown
  // recriam o comportamento de teclado do <button>.
  const handleHeaderKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleHeaderClick()
    }
  }

  return (
    <div
      style={{
        width:        '100%',
        background:   isExpanded ? 'var(--action-surface)' : 'var(--surface)',
        border:       `1px solid ${isExpanded ? 'var(--action)' : 'var(--border)'}`,
        borderRadius: 10,
        overflow:     'hidden',
        transition:   'border-color 0.15s, background 0.15s, box-shadow 0.18s',
        // CRÍTICO: o outer é flex item de uma lista flex-column. Sem min-height
        // explícito o flex-shrink:1 default deixa o outer encolher abaixo dos
        // 56px do inner role=button (em iOS Safari isto colapsa para 2px =
        // apenas borders). flexShrink:0 trava qualquer tentativa de shrinking;
        // minHeight:56 é segurança extra. InlineCountRow não sofria do bug
        // porque o seu conteúdo intrinsic (input 44 + buttons) excede 56.
        minHeight:    56,
        flexShrink:   0,
        boxShadow:    isExpanded ? '0 4px 14px rgba(196, 106, 45, 0.18)' : 'none',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={handleHeaderClick}
        onKeyDown={handleHeaderKeyDown}
        style={{
          display:     'flex',
          alignItems:  'center',
          gap:         10,
          minHeight:   56,
          padding:     '8px 12px',
          width:       '100%',
          boxSizing:   'border-box',
          cursor:      'pointer',
          touchAction: 'manipulation',
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize:     15,
            fontWeight:   600,
            color:        'var(--text)',
            whiteSpace:   'nowrap',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            flexShrink:   1,
            minWidth:     0,
          }}>
            {article.name}
          </span>
          {isMulti && (
            <span
              aria-label="Multi-embalagem"
              style={{
                fontSize:      9,
                fontWeight:    700,
                letterSpacing: 0.5,
                color:         'var(--action)',
                background:    'var(--bg)',
                border:        '1px solid var(--action)',
                borderRadius:  4,
                padding:       '1px 5px',
                flexShrink:    0,
              }}
            >
              MULTI
            </span>
          )}
        </div>
        {/* Chip: valor só quando contado nesta sessão; senão "—". Mesma regra
            do inline — current_qty da DB nunca alimenta o display directamente. */}
        <span style={{
          background:   'var(--surface-2)',
          color:        isCounted ? 'var(--text)' : 'var(--text-subtle)',
          border:       '1px solid var(--border)',
          borderRadius: 8,
          padding:      '4px 10px',
          fontFamily:   'var(--font-mono), monospace',
          fontSize:     15,
          fontWeight:   700,
          lineHeight:   1.2,
          flexShrink:   0,
        }}>
          {isCounted ? formatBaseQty(article.current_qty, article.unit) : '—'}
        </span>
        {/* Chevron sinaliza que o card multi expande. ▴ quando aberto, ▾ fechado. */}
        <span aria-hidden="true" style={{
          fontSize:    11,
          color:       'var(--text-muted)',
          flexShrink:  0,
          marginLeft:  -2,
          lineHeight:  1,
          transition:  'transform 0.15s',
          transform:   isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>▾</span>
      </div>

      {isExpanded && (
        <ExpandedBody
          articleId={article.article_id}
          packagings={packagings}
          baseUnit={article.unit}
          sessionId={sessionId}
          flushPendingRef={flushPendingRef}
          onCounted={onCounted}
        />
      )}
    </div>
  )
}

interface ExpandedBodyProps {
  articleId:       string
  packagings:      Packaging[] | null
  baseUnit:        string
  sessionId:       string | null
  flushPendingRef: React.RefObject<(() => Promise<void>) | null>
  onCounted:       (articleId: string) => void
}

/**
 * Corpo expandido do card multi. Cada linha tem o seu próprio input mas o
 * autosave é colectivo: 1.5s de debounce sobre todas as qtys → uma única
 * call a record_stock_count_multi_inline (idempotente por session_id).
 *
 * Sem botão Guardar, sem "Total 0 g" quando vazio. Status icon no canto
 * superior direito (… ✓ !).
 */
function ExpandedBody({
  articleId,
  packagings,
  baseUnit,
  sessionId,
  flushPendingRef,
  onCounted,
}: ExpandedBodyProps) {
  const bodyRef = useRef<HTMLDivElement>(null)

  // Scroll into view ao abrir.
  useEffect(() => {
    const t = setTimeout(() => {
      bodyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 60)
    return () => clearTimeout(t)
  }, [])

  // Estável: onSaved invoca onCounted.
  const onSavedRef = useRef<() => void>(() => onCounted(articleId))
  useEffect(() => {
    onSavedRef.current = () => onCounted(articleId)
  }, [onCounted, articleId])

  const {
    qtys, status, error,
    setQty, step, flush, retry,
    total, hasAny,
  } = useMultiPackagingAutosave({
    articleId,
    sessionId,
    packagings,
    onSaved: () => onSavedRef.current(),
  })

  // Expõe flush() ao parent para fire-and-forget no collapse.
  useEffect(() => {
    flushPendingRef.current = flush
    return () => { flushPendingRef.current = null }
  }, [flush, flushPendingRef])

  const handleStatusActivate = useCallback(() => {
    if (status === 'error') void retry()
  }, [status, retry])

  const isSimple = packagings !== null && packagings.length === 1

  return (
    <div
      ref={bodyRef}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        padding:       '0 12px 12px',
        display:       'flex',
        flexDirection: 'column',
        gap:           8,
      }}
    >
      {!isSimple && (
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          height:         24,
          margin:         '4px 2px 0',
          borderTop:      '1px solid var(--border)',
          paddingTop:     8,
        }}>
          <span aria-hidden="true" />
          <BodyStatusIcon status={status} error={error} onActivate={handleStatusActivate} />
        </div>
      )}

      {packagings === null && (
        <p style={{ fontSize: 13, color: 'var(--text-subtle)', textAlign: 'center', padding: 16, margin: 0 }}>
          A carregar embalagens…
        </p>
      )}
      {packagings && packagings.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--text-subtle)', textAlign: 'center', padding: 16, margin: 0 }}>
          Sem embalagens disponíveis.
        </p>
      )}
      {packagings && packagings.map((p) => {
        const key   = packagingKey(p)
        const label = formatPackagingLabel(p.label, p.base_per_unit, baseUnit)
        const value = qtys[key] ?? ''
        return (
          <PackagingLine
            key={key}
            label={label}
            value={value}
            onChange={(raw) => setQty(key, raw)}
            onStep={(delta) => step(key, p.base_per_unit, p.label, delta)}
            disabled={false}
          />
        )
      })}

      {!isSimple && hasAny && (
        <div
          aria-live="polite"
          style={{
            display:        'flex',
            alignItems:     'baseline',
            justifyContent: 'space-between',
            paddingTop:     6,
            paddingBottom:  2,
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Total</span>
          <span style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize:   17,
            fontWeight: 700,
            color:      'var(--text)',
          }}>
            {formatBaseQty(total, baseUnit)}
          </span>
        </div>
      )}
    </div>
  )
}

interface BodyStatusIconProps {
  status:     MultiAutosaveStatus
  error:      string | null
  onActivate: () => void
}

function BodyStatusIcon({ status, error, onActivate }: BodyStatusIconProps) {
  const baseStyle: React.CSSProperties = {
    display:    'flex',
    alignItems: 'center',
    gap:        4,
    fontSize:   12,
    fontWeight: 600,
    lineHeight: 1,
  }
  if (status === 'saving' || status === 'dirty') {
    return (
      <span aria-label="A guardar" aria-live="polite" style={{ ...baseStyle, color: 'var(--text-subtle)' }}>
        … A guardar
      </span>
    )
  }
  if (status === 'saved') {
    return (
      <span aria-label="Guardado" aria-live="polite" style={{ ...baseStyle, color: 'var(--success)' }}>
        ✓ Guardado
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
          ...baseStyle,
          background:  'transparent',
          border:      'none',
          color:       'var(--error)',
          cursor:      'pointer',
          touchAction: 'manipulation',
        }}
      >
        ! Erro — toca para tentar
      </button>
    )
  }
  return <span aria-hidden="true" style={{ ...baseStyle, opacity: 0 }}>placeholder</span>
}
