'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { CurrentStock } from '@/types/database'
import type { Packaging, CountLine } from '@/lib/stockCount'
import { packagingKey } from '@/lib/stockCount'
import { formatBaseQty } from '@/lib/units'
import { formatPackagingLabel } from '@/lib/inventory/formatPackagingLabel'
import PackagingLine from './PackagingLine'
import InlineCountRow from './InlineCountRow'

interface ArticleCardProps {
  article:    CurrentStock
  isExpanded: boolean
  packagings: Packaging[] | null
  isSaving:   boolean
  isCounted:  boolean
  sessionId:  string | null
  onToggle:   () => void
  onSave:     (lines: CountLine[]) => void
  onCounted:  (articleId: string) => void
}

function parseQty(raw: string): number {
  const n = parseFloat(raw.replace(',', '.'))
  return isNaN(n) ? NaN : n
}

export default function ArticleCard({
  article,
  isExpanded,
  packagings,
  isSaving,
  isCounted,
  sessionId,
  onToggle,
  onSave,
  onCounted,
}: ArticleCardProps) {
  const isSimpleInline =
    article.packaging_count === 1 &&
    article.single_packaging_label !== null &&
    article.single_packaging_base_per_unit !== null

  const isMulti = (packagings?.length ?? 0) > 1

  const hasUnsavedRef = useRef(false)

  const handleHeaderClick = useCallback(() => {
    if (isExpanded && hasUnsavedRef.current) {
      if (typeof window !== 'undefined' && !window.confirm('Descartar contagem?')) return
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

  return (
    <div
      style={{
        width:        '100%',
        background:   isExpanded ? 'var(--action-surface)' : 'var(--surface)',
        border:       `1px solid ${isExpanded ? 'var(--action)' : 'var(--border)'}`,
        borderRadius: 10,
        overflow:     'hidden',
        transition:   'border-color 0.15s, background 0.15s',
      }}
    >
      <button
        type="button"
        onClick={handleHeaderClick}
        disabled={isSaving}
        style={{
          width:       '100%',
          background:  'transparent',
          border:      'none',
          padding:     '8px 12px',
          cursor:      isSaving ? 'default' : 'pointer',
          textAlign:   'left',
          display:     'flex',
          alignItems:  'center',
          gap:         10,
          minHeight:   56,
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
          {isCounted && (
            <span style={{ fontSize: 13, color: 'var(--success)', fontWeight: 700, flexShrink: 0 }}>✓</span>
          )}
          {isSaving && (
            <span style={{ fontSize: 12, color: 'var(--text-subtle)', flexShrink: 0 }}>…</span>
          )}
        </div>
        <span style={{
          background:   'var(--surface-2)',
          color:        'var(--text)',
          border:       '1px solid var(--border)',
          borderRadius: 8,
          padding:      '4px 10px',
          fontFamily:   'var(--font-mono), monospace',
          fontSize:     15,
          fontWeight:   700,
          lineHeight:   1.2,
          flexShrink:   0,
        }}>
          {formatBaseQty(article.current_qty, article.unit)}
        </span>
      </button>

      {isExpanded && (
        <ExpandedBody
          packagings={packagings}
          baseUnit={article.unit}
          currentQty={article.current_qty}
          isSaving={isSaving}
          hasUnsavedRef={hasUnsavedRef}
          onSave={onSave}
        />
      )}
    </div>
  )
}

interface ExpandedBodyProps {
  packagings:    Packaging[] | null
  baseUnit:      string
  currentQty:    number
  isSaving:      boolean
  hasUnsavedRef: React.RefObject<boolean>
  onSave:        (lines: CountLine[]) => void
}

function ExpandedBody({
  packagings,
  baseUnit,
  currentQty,
  isSaving,
  hasUnsavedRef,
  onSave,
}: ExpandedBodyProps) {
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      bodyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 60)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    hasUnsavedRef.current = Object.values(qtys).some(v => parseQty(v) > 0)
    return () => { hasUnsavedRef.current = false }
  }, [qtys, hasUnsavedRef])

  const total = useMemo(() => {
    if (!packagings) return 0
    return packagings.reduce((sum, p) => {
      const n = parseQty(qtys[packagingKey(p)] ?? '')
      if (isNaN(n) || n <= 0) return sum
      return sum + n * p.base_per_unit
    }, 0)
  }, [packagings, qtys])

  const isSimple = packagings !== null && packagings.length === 1

  const saveDisabled = isSaving || (total === 0 && currentQty === 0)

  const handleSave = useCallback(() => {
    if (!packagings) return
    const lines: CountLine[] = packagings
      .map(p => {
        const n = parseQty(qtys[packagingKey(p)] ?? '')
        return { label: p.label, qty: isNaN(n) ? 0 : n, base_per_unit: p.base_per_unit }
      })
      .filter(l => l.qty > 0)

    if (lines.length === 0) {
      if (currentQty > 0) {
        if (typeof window === 'undefined' || !window.confirm('Esgotaste este artigo? O stock vai a 0.')) return
        onSave([{ label: 'esgotado', qty: 0, base_per_unit: 1 }])
      }
      return
    }
    onSave(lines)
  }, [packagings, qtys, currentQty, onSave])

  const setQty = useCallback((key: string, raw: string) => {
    setQtys(prev => ({ ...prev, [key]: raw }))
  }, [])

  const stepQty = useCallback((key: string, delta: number) => {
    setQtys(prev => {
      const parsed  = parseFloat((prev[key] ?? '0').replace(',', '.'))
      const current = isNaN(parsed) ? 0 : parsed
      const next    = Math.max(0, current + delta)
      if (next === 0) return { ...prev, [key]: '' }
      const display = Number.isInteger(next) ? String(next) : String(next).replace('.', ',')
      return { ...prev, [key]: display }
    })
  }, [])

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
        <div style={{ height: 1, background: 'var(--border)', margin: '4px 2px 4px' }} />
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
            onStep={(delta) => stepQty(key, delta)}
            disabled={isSaving}
          />
        )
      })}

      {!isSimple && (
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
            color:      total > 0 ? 'var(--text)' : 'var(--text-subtle)',
          }}>
            {formatBaseQty(total, baseUnit)}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saveDisabled}
        aria-busy={isSaving}
        aria-label="Guardar contagem"
        style={{
          width:        '100%',
          minHeight:    48,
          marginTop:    4,
          borderRadius: 10,
          border:       'none',
          background:   saveDisabled ? 'var(--action-disabled)' : 'var(--action)',
          color:        'var(--white)',
          fontSize:     16,
          fontWeight:   700,
          cursor:       saveDisabled ? 'not-allowed' : 'pointer',
          opacity:      saveDisabled && !isSaving ? 0.6 : 1,
        }}
      >
        {isSaving ? '…' : 'Guardar'}
      </button>
    </div>
  )
}
