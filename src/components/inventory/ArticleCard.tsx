'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { CurrentStock } from '@/types/database'
import type { Packaging, CountLine } from '@/lib/stockCount'
import { packagingKey } from '@/lib/stockCount'
import { formatBaseQty } from '@/lib/units'
import PackagingLine from './PackagingLine'
import InlineCountRow from './InlineCountRow'

interface ArticleCardProps {
  article:    CurrentStock
  isExpanded: boolean
  packagings: Packaging[] | null
  isSaving:   boolean
  isCounted:  boolean
  isSkipped:  boolean
  sessionId:  string | null
  onToggle:   () => void
  onSkip:     (articleId: string) => void
  onSave:     (lines: CountLine[]) => void
  onCounted:  (articleId: string) => void
}

function parseQty(raw: string): number {
  const n = parseFloat(raw.replace(',', '.'))
  return isNaN(n) ? NaN : n
}

// Insere espaço entre dígito-letra e letra-dígito em labels colados
// ("saco25kg" → "saco 25 kg", "5L" → "5 L", "200g" → "200 g").
function spaceDigitsAndLetters(s: string): string {
  return s
    .replace(/([a-zA-Zµ])(\d)/g, '$1 $2')
    .replace(/(\d)\s*([a-zA-Zµ])/g, '$1 $2')
}

// Display da label da embalagem.
// - fallback: "Unidade" para 'un', "A granel" para g/mL/kg/L, original para exóticos
// - tem dígito: normaliza espaços ("saco 25kg" → "saco 25 kg")
// - sem dígito: anexa formatBaseQty(base_per_unit, baseUnit)
function formatPackagingLabel(p: Packaging, baseUnit: string): string {
  if (p.source === 'fallback') {
    if (baseUnit === 'un')                                  return 'Unidade'
    if (['g', 'mL', 'kg', 'L'].includes(baseUnit))          return 'A granel'
    return p.label
  }
  if (/\d/.test(p.label))      return spaceDigitsAndLetters(p.label)
  return `${p.label} ${formatBaseQty(p.base_per_unit, baseUnit)}`
}

export default function ArticleCard({
  article,
  isExpanded,
  packagings,
  isSaving,
  isCounted,
  isSkipped,
  sessionId,
  onToggle,
  onSkip,
  onSave,
  onCounted,
}: ArticleCardProps) {
  // Branch single-packaging → linha inline directa (C1.3). Sem expansão,
  // sem botão Guardar. Multi-embalagem (count > 1) cai no caminho
  // legado abaixo, intacto desde a Fase A/B.
  const isSimpleInline =
    article.packaging_count === 1 &&
    article.single_packaging_label !== null &&
    article.single_packaging_base_per_unit !== null

  const isMulti = (packagings?.length ?? 0) > 1

  // Sinalizado pelo ExpandedBody enquanto montado. Lido em handleHeaderClick
  // para confirmar descarte de contagem ao colapsar.
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
        isSkipped={isSkipped}
        onCounted={onCounted}
        onSkip={onSkip}
      />
    )
  }

  return (
    <div
      style={{
        width:        '100%',
        background:   isExpanded ? 'var(--action-surface)' : 'var(--surface)',
        border:       `1px solid ${isExpanded ? 'var(--action)' : 'var(--border)'}`,
        borderRadius: 12,
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
          padding:     '12px 14px',
          cursor:      isSaving ? 'default' : 'pointer',
          textAlign:   'left',
          display:     'flex',
          alignItems:  'center',
          gap:         12,
          minHeight:   60,
        }}
      >
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
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
            {isSkipped && !isCounted && (
              <span
                aria-label="Marcado para contar depois"
                style={{
                  fontSize:   11,
                  color:      'var(--text-subtle)',
                  fontWeight: 500,
                  flexShrink: 0,
                }}
              >depois</span>
            )}
            {isSaving && (
              <span style={{ fontSize: 12, color: 'var(--text-subtle)', flexShrink: 0 }}>…</span>
            )}
          </div>
        </div>
        <div style={{
          flexShrink:    0,
          display:       'flex',
          flexDirection: 'column',
          alignItems:    'flex-end',
          gap:           2,
          minWidth:      72,
        }}>
          <span style={{
            background:   'var(--surface-2)',
            color:        'var(--text)',
            border:       '1px solid var(--border)',
            borderRadius: 8,
            padding:      '4px 10px',
            fontFamily:   'var(--font-mono), monospace',
            fontSize:     16,
            fontWeight:   700,
            lineHeight:   1.2,
          }}>
            {formatBaseQty(article.current_qty, article.unit)}
          </span>
        </div>
      </button>

      {isExpanded && (
        <ExpandedBody
          packagings={packagings}
          baseUnit={article.unit}
          currentQty={article.current_qty}
          isSaving={isSaving}
          hasUnsavedRef={hasUnsavedRef}
          onSkip={() => onSkip(article.article_id)}
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
  onSkip:        () => void
  onSave:        (lines: CountLine[]) => void
}

/**
 * Corpo expandido do card. Monta/desmonta com isExpanded — qtys vivem só
 * enquanto está aberto, ficando descartadas ao colapsar (Contar depois ou
 * tap em outro card).
 */
function ExpandedBody({
  packagings,
  baseUnit,
  currentQty,
  isSaving,
  hasUnsavedRef,
  onSkip,
  onSave,
}: ExpandedBodyProps) {
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const bodyRef = useRef<HTMLDivElement>(null)

  // Scroll into view ao montar (uma vez), só se não estiver totalmente visível.
  useEffect(() => {
    const t = setTimeout(() => {
      bodyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 60)
    return () => clearTimeout(t)
  }, [])

  // Sinaliza ao parent se há quantidades por guardar — usado para confirmar
  // descarte ao colapsar via header. Reset no unmount (próximo expand começa limpo).
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

  // Compactação para artigo de 1 embalagem: esconde separador e linha "Total"
  // (redundante quando há um único packaging — o número typed coincide com o
  // total exibido). Não afecta p_lines: handleSave continua a iterar packagings.
  const isSimple = packagings !== null && packagings.length === 1

  // Guardar disabled quando: a guardar; ou (total=0 AND stock atual já era 0).
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
      // Esgotar stock: confirma só quando há stock anterior.
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
        const label = formatPackagingLabel(p, baseUnit)
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

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          type="button"
          onClick={onSkip}
          disabled={isSaving}
          aria-label="Contar depois"
          style={{
            flex:         1,
            minHeight:    48,
            borderRadius: 10,
            border:       '1px solid var(--border)',
            background:   'transparent',
            color:        'var(--text-muted)',
            fontSize:     14,
            fontWeight:   600,
            cursor:       isSaving ? 'default' : 'pointer',
          }}
        >
          Contar depois
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saveDisabled}
          aria-busy={isSaving}
          aria-label="Guardar contagem"
          style={{
            flex:         2,
            minHeight:    48,
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
    </div>
  )
}
