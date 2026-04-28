'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Article } from '@/types/database'
import { createArticle, createArticleSizeIfMissing } from '@/lib/supabase'
import {
  formatUnit,
  formatBaseQty,
  parsePackagingQuantity,
} from '@/lib/units'
import {
  parseProductLines,
  recomputeDuplicates,
  type ParsedLine,
} from '@/lib/parseProductLines'
import { suggestCategory, ARTICLE_CATEGORIES } from '@/lib/categoryKeywords'
import { maybeLearnAlias, normalizeKey } from '@/lib/ingredientDictionary'
import { useOrgAliases } from '@/hooks/useOrgAliases'
import {
  getCountingMode,
  getCountingModeOptions,
  inferIntent,
  type CountingMode,
} from '@/lib/articleDraft'
import { getSuggestedUnitWeight } from '@/lib/unitWeightSuggestions'
import { CONFIDENCE_REASON_LABELS } from '@/lib/articleConfidence'

// ── Estado UI por linha ──────────────────────────────────────────────────────
// Vive ao lado de ParsedLine. NÃO estendemos ParsedLine porque é o output puro
// do parser (single source of truth partilhado com o motor/manual). Estado UI
// (par_level digitado, toggle de counting, expansão) é responsabilidade desta
// component apenas.

type LineUiState = {
  parDisplay:           string  // valor digitado em counting_unit (não em base)
  selectedCountingIdx:  number  // 0 default; muda via toggle multipack
  gPerUnit:             string  // só usado quando line.unit === 'un'
  expanded:             boolean
}

const defaultUiState = (): LineUiState => ({
  parDisplay:          '',
  selectedCountingIdx: 0,
  gPerUnit:            '',
  expanded:            false,
})

// Reconstrói as opções de contagem para uma linha. Mesmo motor que o manual
// (`getCountingModeOptions`) — o `intent` é re-derivado a partir dos campos
// que `parseProductLines` exporta. O multipack é honrado para que o toggle
// apareça em casos como "leite 1L pack 6".
function lineCountingOptions(line: ParsedLine): CountingMode[] {
  if (line.unit !== 'g' && line.unit !== 'mL' && line.unit !== 'un') return []
  const factor = parseFloat(line.base_per_order)
  const supplierSeed = line.stock_unit
    ? {
        order_unit:        line.stock_unit,
        conversion_factor: !isNaN(factor) && factor > 0 ? factor : undefined,
        source:            'detected' as const,
      }
    : undefined
  const multipack = line.detected_multipack
    ? { count: line.detected_multipack.count, perPack: line.detected_multipack.perPack }
    : undefined
  const intent = inferIntent({ unit: line.unit, supplierSeed, multipack })
  return getCountingModeOptions({ intent })
}

// ── Estilos base ──────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize:      10,
  fontWeight:    700,
  letterSpacing: '0.08em',
  color:         'var(--text-on-primary-muted)',
  marginBottom:  4,
  display:       'block',
}

const inputStyle: React.CSSProperties = {
  width:        '100%',
  height:       44,
  background:   'var(--border-on-primary-soft)',
  border:       '1px solid var(--border-on-primary)',
  borderRadius: 6,
  padding:      '0 8px',
  color:        'var(--text-on-primary)',
  fontSize:     13,
  outline:      'none',
  boxSizing:    'border-box',
}

// ── SeedHint (read-only — só visível em expansão) ────────────────────────────

function SeedHint({ line }: { line: ParsedLine }) {
  if (!line.stock_unit) return null
  const qty    = parseFloat(line.base_per_order)
  const hasQty = !isNaN(qty) && qty > 0 && line.unit.trim() !== ''
  const mp     = line.detected_multipack

  let body: string
  if (mp) {
    body = `${line.stock_unit} · ${mp.count} x ${formatUnit(mp.perPack, line.unit)}`
  } else if (hasQty) {
    body = `${line.stock_unit} · ${formatUnit(qty, line.unit)}`
  } else {
    body = line.stock_unit
  }

  return (
    <p style={{
      fontSize:      11,
      color:         'var(--text-on-primary-faint)',
      fontFamily:    'JetBrains Mono, monospace',
      letterSpacing: '0.02em',
      margin:        0,
    }}>
      Detetado: {body}
    </p>
  )
}

// ── CountingPill — toggle quando há multipack, pill estática quando não há ──

function CountingPill({
  options, selectedIdx, baseUnit, onSelect,
}: {
  options:     CountingMode[]
  selectedIdx: number
  baseUnit:    'g' | 'mL' | 'un'
  onSelect:    (idx: number) => void
}) {
  const isToggle = options.length > 1
  return (
    <div
      role={isToggle ? 'group' : undefined}
      aria-label={isToggle ? 'Conta em' : undefined}
      style={{ display: 'inline-flex', gap: isToggle ? 4 : 0 }}
    >
      {options.map((opt, idx) => {
        const active = idx === selectedIdx
        const showDetail = opt.base_per_unit !== 1
          && opt.count_unit !== 'kg'
          && opt.count_unit !== 'L'
          && opt.count_unit !== 'un'
        return (
          <button
            key={`${opt.count_unit}-${idx}`}
            type="button"
            onClick={isToggle ? () => onSelect(idx) : undefined}
            disabled={!isToggle}
            aria-pressed={isToggle ? active : undefined}
            style={{
              height:        44,
              padding:       '0 10px',
              borderRadius:  20,
              border:        `1px solid ${active && isToggle ? 'var(--action)' : 'var(--border-on-primary)'}`,
              background:    active && isToggle ? 'var(--action)' : 'var(--border-on-primary-soft)',
              color:         'var(--text-on-primary)',
              fontFamily:    'JetBrains Mono, monospace',
              fontSize:      12,
              fontWeight:    700,
              cursor:        isToggle ? 'pointer' : 'default',
              touchAction:   'manipulation',
              display:       'inline-flex',
              alignItems:    'center',
              gap:           4,
              whiteSpace:    'nowrap',
            }}
          >
            {opt.count_unit}
            {showDetail && (
              <span style={{
                fontWeight: 500,
                color:      active && isToggle ? 'var(--text-on-primary)' : 'var(--text-on-primary-faint)',
                opacity:    active && isToggle ? 0.85 : 1,
              }}>
                ({formatBaseQty(opt.base_per_unit, baseUnit)})
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── ParInput — numeric + sufixo (counting_unit) ──────────────────────────────

function ParInput({
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
      background:   'var(--border-on-primary-soft)',
      border:       '1px solid var(--border-on-primary)',
      borderRadius: 6,
      padding:      '0 12px',
      gap:          8,
      minWidth:     168,
      flex:         '0 1 auto',
    }}>
      <span style={{
        fontSize:    12,
        fontWeight:  600,
        color:       'var(--text-on-primary-muted)',
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
          color:      'var(--text-on-primary)',
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
        color:      'var(--text-on-primary-muted)',
        fontFamily: 'JetBrains Mono, monospace',
        whiteSpace: 'nowrap',
      }}>
        {suffix}
      </span>
    </div>
  )
}

// ── CategoryChipSelect — chip subtil com <select> nativo invisível por cima ──
// Decisões cravadas:
//  • Sempre visível na linha compacta (mesmo sem categoria → "definir categoria")
//  • Lista canónica `ARTICLE_CATEGORIES`. Se a linha já tiver valor fora da
//    lista (alias legado), preserva-o como opção extra para não fazer reset.
//  • `<select>` ocupa toda a área da chip com opacity:0 → tap nativo iOS/Android
//    com picker do OS, zero código de dropdown custom. Chip mantém height=44
//    para tap target ≥44px, mas estilo (font 10, bg transparente, opacity 0.75)
//    fá-la ler como secundária ao lado de CONTA EM e MÍNIMO.
//  • categoryConfident=true é injectado em handleLineChange quando field='category'.
function CategoryChipSelect({
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
                       : !hasCategory ? '1px dashed var(--border-on-primary)'
                                       : 'none',
          borderRadius:  6,
          fontSize:      12,
          fontWeight:    500,
          color:         'var(--text-on-primary-muted)',
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
          color:         'var(--text-on-primary-faint)',
          flexShrink:    0,
        }}>Cat.</span>
        <span style={{
          color:        showWarning ? 'var(--warning)' : 'var(--text-on-primary)',
          fontStyle:    hasCategory ? 'normal' : 'italic',
          fontWeight:   hasCategory ? 600 : 500,
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}>{display}</span>
        <span style={{
          fontSize:   10,
          color:      'var(--text-on-primary-faint)',
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

// ── LineRow — linha compacta + bloco expandido ───────────────────────────────

type LineRowProps = {
  line:                ParsedLine
  ui:                  LineUiState
  options:             CountingMode[]
  isResolved?:         boolean
  onChange:            (id: string, field: keyof ParsedLine, value: string) => void
  onDelete:            (id: string) => void
  onParChange:         (id: string, value: string) => void
  onCountingIdxChange: (id: string, idx: number) => void
  onGPerUnitChange:    (id: string, value: string) => void
  onExpandToggle:      (id: string) => void
  onResolved?:         (id: string) => void
}

function LineRow({
  line, ui, options, isResolved,
  onChange, onDelete, onParChange, onCountingIdxChange, onGPerUnitChange, onExpandToggle, onResolved,
}: LineRowProps) {
  const isInvalid   = line.name.trim() === '' || line.unit.trim() === ''
  const unitMissing = line.unit.trim() === ''
  const safeIdx     = options.length > 0 ? Math.min(ui.selectedCountingIdx, options.length - 1) : 0
  const cm          = options[safeIdx] ?? null
  const showLow     = !isInvalid && line.confidence === 'low'
  const showMedium  = !isInvalid && line.confidence === 'medium'
  const isUn        = line.unit === 'un'
  const baseUnit    = line.unit as 'g' | 'mL' | 'un'

  const suggestion = isUn && !ui.gPerUnit.trim() && line.name.trim().length >= 3
    ? getSuggestedUnitWeight(line.name)
    : null

  // Chevron só aparece quando há algo realmente expandível.
  // LOW reasons já têm o seu próprio banner FORA da expansão (não conta aqui).
  // Linhas como "frango" ou "azeite" (clean name, unit inferido, sem packaging
  // detectado, alta confiança) caem aqui → expansão vazia, chevron escondido.
  const hasExpansionContent =
    !unitMissing && (
      isUn ||
      Boolean(line.stock_unit) ||
      (showMedium && line.confidenceReasons.length > 0)
    )

  return (
    <div style={{
      background:    isInvalid     ? 'var(--error-surface)'
                   : isResolved    ? 'var(--success-surface-on-primary)'
                                   : 'var(--border-on-primary-soft)',
      border:        `1px solid ${
        isInvalid     ? 'var(--error-border)'
      : showLow       ? 'var(--warning)'
      : isResolved    ? 'var(--success-border-on-primary)'
                      : 'var(--border-on-primary-soft)'
      }`,
      borderRadius:  8,
      padding:       '12px 14px',
      display:       'flex',
      flexDirection: 'column',
      gap:           10,  // breathing room entre nome / decisões / metadados
    }}>
      {/* LOW banner — sempre visível, mesmo em compacto */}
      {showLow && (
        <div style={{
          display:      'flex',
          alignItems:   'flex-start',
          gap:          8,
          fontSize:     11,
          color:        'var(--text-on-primary)',
          background:   'var(--error-surface)',
          border:       '1px solid var(--warning)',
          borderRadius: 6,
          padding:      '6px 8px',
          lineHeight:   1.4,
        }}>
          <span style={{ color: 'var(--warning)', fontWeight: 700, fontSize: 13, lineHeight: 1 }}>!</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>A resolver</div>
            <ul style={{ margin: 0, paddingLeft: 14, listStyle: 'disc' }}>
              {line.confidenceReasons.map(r => (
                <li key={r}>{CONFIDENCE_REASON_LABELS[r]}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Linha 1: NOME (full-width) + chevron de expansão */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            value={line.name}
            onChange={e => onChange(line.id, 'name', e.target.value)}
            placeholder="Nome do produto"
            aria-label="Nome do produto"
            style={{
              ...inputStyle,
              border: line.name.trim() === '' ? '1px solid var(--error)' : inputStyle.border,
            }}
          />
          {showMedium && line.confidenceReasons.length > 0 && (
            <span
              title={line.confidenceReasons.map(r => CONFIDENCE_REASON_LABELS[r]).join(' · ')}
              aria-label="Verifica os detalhes"
              style={{
                display:       'inline-block',
                width:         8,
                height:        8,
                borderRadius:  '50%',
                background:    'var(--text-on-primary-faint)',
                marginLeft:    6,
                verticalAlign: 'middle',
              }}
            />
          )}
        </div>
        {hasExpansionContent && (
          <button
            type="button"
            onClick={() => onExpandToggle(line.id)}
            aria-label={ui.expanded ? 'Recolher detalhes' : 'Expandir detalhes'}
            aria-expanded={ui.expanded}
            style={{
              width:          44,
              height:         44,
              borderRadius:   6,
              border:         'none',
              background:     'transparent',
              color:          'var(--text-on-primary-faint)',
              fontSize:       14,
              cursor:         'pointer',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              flexShrink:     0,
              touchAction:    'manipulation',
              transition:     'transform 0.15s',
              transform:      ui.expanded ? 'rotate(180deg)' : 'none',
            }}
          >
            ▾
          </button>
        )}
      </div>

      {/* Linha 2: DECISÕES — counting + stock mínimo (alta prioridade visual) */}
      {!unitMissing && cm && (
        <div style={{
          display:    'flex',
          flexWrap:   'wrap',
          alignItems: 'center',
          gap:        8,
        }}>
          <CountingPill
            options={options}
            selectedIdx={safeIdx}
            baseUnit={baseUnit}
            onSelect={(idx) => onCountingIdxChange(line.id, idx)}
          />
          <ParInput
            value={ui.parDisplay}
            suffix={cm.count_unit}
            onChange={(v) => onParChange(line.id, v)}
          />
        </div>
      )}

      {/* Linha 3: METADADOS — categoria + hint opcional + delete (baixa prioridade) */}
      {!unitMissing && cm && (
        <div style={{
          display:    'flex',
          flexWrap:   'wrap',
          alignItems: 'center',
          gap:        8,
        }}>
          <CategoryChipSelect
            value={line.category}
            categoryConfident={line.categoryConfident}
            onChange={(v) => onChange(line.id, 'category', v)}
          />
          {isUn && !ui.gPerUnit.trim() && !ui.expanded && (
            <span
              title="Define o peso médio por unidade no painel expandido (opcional)"
              style={{
                fontSize:    11,
                fontStyle:   'italic',
                color:       'var(--text-on-primary-faint)',
                flexShrink:  0,
                whiteSpace:  'nowrap',
              }}
            >
              peso/un opcional
            </span>
          )}
          <button
            onClick={() => onDelete(line.id)}
            title="Eliminar linha"
            aria-label="Eliminar linha"
            style={{
              marginLeft:     'auto',
              width:          44,
              height:         44,
              borderRadius:   6,
              border:         'none',
              background:     'transparent',
              color:          'var(--text-on-primary-faint)',
              fontSize:       18,
              cursor:         'pointer',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              flexShrink:     0,
              touchAction:    'manipulation',
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Estado A RESOLVER: chef escolhe unidade aqui mesmo na linha compacta */}
      {unitMissing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ ...labelStyle, color: 'var(--warning-text)', marginBottom: 0 }}>
            Seleciona unidade
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['g', 'mL', 'un'] as const).map(u => (
              <button
                key={u}
                type="button"
                onClick={() => {
                  onChange(line.id, 'unit', u)
                  onResolved?.(line.id)
                }}
                style={{
                  height:        44,
                  minWidth:      48,
                  borderRadius:  6,
                  border:        '1px solid var(--action-border)',
                  background:    'var(--action-surface)',
                  color:         'var(--action)',
                  fontSize:      11,
                  fontWeight:    700,
                  cursor:        'pointer',
                  fontFamily:    'JetBrains Mono, monospace',
                  touchAction:   'manipulation',
                }}
              >
                {u}
              </button>
            ))}
          </div>
          <button
            onClick={() => onDelete(line.id)}
            title="Eliminar linha"
            aria-label="Eliminar linha"
            style={{
              marginLeft:     'auto',
              width:          44,
              height:         44,
              borderRadius:   6,
              border:         'none',
              background:     'transparent',
              color:          'var(--text-on-primary-faint)',
              fontSize:       18,
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
      )}

      {/* Bloco expandido: g_per_unit (un) · SeedHint · medium reasons.
          Gate por hasExpansionContent garante que nunca renderiza vazio (linhas
          com unit !== 'un' + sem stock_unit + não-medium não têm conteúdo). */}
      {ui.expanded && hasExpansionContent && (
        <div style={{
          display:       'flex',
          flexDirection: 'column',
          gap:           10,
          marginTop:     4,
          paddingTop:    10,
          borderTop:     '1px dashed var(--border-on-primary)',
        }}>
          {isUn && (
            <div>
              <label style={labelStyle}>PESO MÉDIO POR UNIDADE</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'stretch', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="ex: 180g"
                  value={ui.gPerUnit}
                  onChange={e => onGPerUnitChange(line.id, e.target.value)}
                  aria-label="Peso médio por unidade"
                  style={{ ...inputStyle, height: 44, flex: '1 1 140px', fontSize: 14 }}
                />
                {suggestion != null && (
                  <button
                    type="button"
                    onClick={() => onGPerUnitChange(line.id, String(suggestion))}
                    aria-label={`Usar sugestão Zesto: ${suggestion}g`}
                    style={{
                      height:        44,
                      padding:       '0 12px',
                      background:    'var(--action-surface)',
                      border:        '1px solid var(--action-border)',
                      borderRadius:  6,
                      cursor:        'pointer',
                      fontSize:      12,
                      color:         'var(--action)',
                      fontWeight:    600,
                      whiteSpace:    'nowrap',
                      display:       'inline-flex',
                      alignItems:    'center',
                      gap:           6,
                      touchAction:   'manipulation',
                    }}
                  >
                    ≈ {suggestion}g · Usar
                  </button>
                )}
              </div>
              <p style={{
                fontSize:   10,
                color:      'var(--text-on-primary-faint)',
                margin:     '4px 0 0',
                lineHeight: 1.4,
              }}>
                Opcional. Útil quando uma &quot;unidade&quot; tem peso (ex.: ovo ≈ 60g).
              </p>
            </div>
          )}

          <SeedHint line={line} />

          {showMedium && line.confidenceReasons.length > 0 && (
            <ul style={{
              margin:      0,
              paddingLeft: 16,
              fontSize:    11,
              color:       'var(--text-on-primary-faint)',
              listStyle:   'disc',
            }}>
              {line.confidenceReasons.map(r => (
                <li key={r}>{CONFIDENCE_REASON_LABELS[r]}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ── Cards (wrappers visuais que delegam ao LineRow) ──────────────────────────

type CardSharedProps = {
  line:                ParsedLine
  ui:                  LineUiState
  options:             CountingMode[]
  onChange:            (id: string, field: keyof ParsedLine, value: string) => void
  onDelete:            (id: string) => void
  onParChange:         (id: string, value: string) => void
  onCountingIdxChange: (id: string, idx: number) => void
  onGPerUnitChange:    (id: string, value: string) => void
  onExpandToggle:      (id: string) => void
}

function OkCard({
  isForced, isResolved, ...rest
}: CardSharedProps & { isForced: boolean; isResolved: boolean }) {
  return (
    <div>
      {isForced && (
        <div style={{ marginBottom: 4 }}>
          <span style={{
            fontSize:      9,
            fontWeight:    700,
            letterSpacing: '0.1em',
            color:         'var(--success-on-primary)',
            background:    'var(--success-surface-on-primary)',
            border:        '1px solid var(--success-border-on-primary)',
            borderRadius:  4,
            padding:       '1px 6px',
          }}>
            NOVO
          </span>
        </div>
      )}
      <LineRow {...rest} isResolved={isResolved} />
    </div>
  )
}

function PartialCard({
  onResolved, ...rest
}: CardSharedProps & { onResolved: (id: string) => void }) {
  return <LineRow {...rest} onResolved={onResolved} />
}

function DuplicateCard({
  line, onForceCreate, onDelete,
}: { line: ParsedLine; onForceCreate: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <div style={{
      background:     'var(--border-on-primary-soft)',
      border:         '1px solid var(--border-on-primary-soft)',
      borderRadius:   8,
      padding:        '10px 12px',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',
      gap:            8,
    }}>
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: 13, color: 'var(--text-on-primary-faint)', textDecoration: 'line-through' }}>
          {line.name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-on-primary-faint)', marginLeft: 8 }}>
          {line.isDuplicateInBatch && !line.isDuplicate ? 'repetido na lista' : 'já existe'}
        </span>
        <SeedHint line={line} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button
          onClick={() => onForceCreate(line.id)}
          style={{
            height:       44,
            borderRadius: 6,
            border:       '1px solid var(--action-border)',
            background:   'var(--action-surface)',
            color:        'var(--action)',
            fontSize:     11,
            fontWeight:   600,
            cursor:       'pointer',
            padding:      '0 10px',
            whiteSpace:   'nowrap',
          }}
        >
          Criar mesmo assim
        </button>
        <button
          onClick={() => onDelete(line.id)}
          title="Remover da lista"
          aria-label="Remover da lista"
          style={{
            width:          44,
            height:         44,
            borderRadius:   6,
            border:         '1px solid var(--border-on-primary-soft)',
            background:     'none',
            color:          'var(--text-on-primary-faint)',
            fontSize:       14,
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
    </div>
  )
}

// ── Painel principal ─────────────────────────────────────────────────────────

type Props = {
  articles:        Article[]
  onCancel:        () => void
  onBatchCreated:  () => void
}

export default function BulkImportPanel({ articles, onCancel, onBatchCreated }: Props) {
  const router = useRouter()
  const { aliases, learnAlias } = useOrgAliases()
  const [step,         setStep]         = useState<'input' | 'preview' | 'success'>('input')
  const [rawText,      setRawText]      = useState('')
  const [lines,        setLines]        = useState<ParsedLine[]>([])
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [result,       setResult]       = useState<{ created: number; failed: string[] } | null>(null)
  const [successCount, setSuccessCount] = useState(0)

  // UI state per-line — mantida ao lado de `lines` para não poluir ParsedLine.
  const [uiState, setUiState] = useState<Map<string, LineUiState>>(new Map())

  // Feedback visual: IDs que acabaram de ser resolvidos (~800ms verde)
  const [justResolvedIds, setJustResolvedIds] = useState<Set<string>>(new Set())
  // Override local de duplicados: IDs que o utilizador forçou criar
  const [forcedIds, setForcedIds] = useState<Set<string>>(new Set())

  const handleResolved = useCallback((id: string) => {
    setJustResolvedIds(s => new Set([...s, id]))
    setTimeout(() => {
      setJustResolvedIds(s => { const next = new Set(s); next.delete(id); return next })
    }, 800)
  }, [])

  const handleForceCreate = useCallback((id: string) => {
    setForcedIds(s => new Set([...s, id]))
    setJustResolvedIds(s => new Set([...s, id]))
    setTimeout(() => {
      setJustResolvedIds(s => { const next = new Set(s); next.delete(id); return next })
    }, 800)
  }, [])

  const handleIgnoreAllDuplicates = useCallback((ids: string[]) => {
    setLines(prev => prev.map(l => ids.includes(l.id) ? { ...l, deleted: true } : l))
  }, [])

  // ── UI state helpers ──────────────────────────────────────────────────────

  const updateUiState = useCallback((id: string, partial: Partial<LineUiState>) => {
    setUiState(prev => {
      const next = new Map(prev)
      const cur  = next.get(id) ?? defaultUiState()
      next.set(id, { ...cur, ...partial })
      return next
    })
  }, [])

  const handleParChange = useCallback((id: string, value: string) => {
    updateUiState(id, { parDisplay: value })
  }, [updateUiState])

  const handleGPerUnitChange = useCallback((id: string, value: string) => {
    updateUiState(id, { gPerUnit: value })
  }, [updateUiState])

  const handleExpandToggle = useCallback((id: string) => {
    setUiState(prev => {
      const next = new Map(prev)
      const cur  = next.get(id) ?? defaultUiState()
      next.set(id, { ...cur, expanded: !cur.expanded })
      return next
    })
  }, [])

  // Toggle de counting mode preserva o valor base e recalcula o display.
  // Mesmo invariant do manual (ArticleForm ~linha 968-981).
  const handleCountingIdxChange = useCallback((id: string, newIdx: number) => {
    setUiState(prev => {
      const next = new Map(prev)
      const cur  = next.get(id) ?? defaultUiState()
      if (cur.selectedCountingIdx === newIdx) return prev

      const line = lines.find(l => l.id === id)
      if (!line) return prev
      const opts = lineCountingOptions(line)
      const oldOpt = opts[Math.min(cur.selectedCountingIdx, opts.length - 1)]
      const newOpt = opts[newIdx]
      if (!oldOpt || !newOpt) return prev

      const baseValue  = (parseFloat(cur.parDisplay) || 0) * oldOpt.base_per_unit
      const newDisplay = baseValue > 0 && newOpt.base_per_unit > 0
        ? String(+(baseValue / newOpt.base_per_unit).toFixed(2))
        : ''

      next.set(id, { ...cur, selectedCountingIdx: newIdx, parDisplay: newDisplay })
      return next
    })
  }, [lines])

  // ── Step: Input ─────────────────────────────────────────────────────────────

  const lineCount = rawText.split('\n').filter(l => l.trim() !== '').length

  const handleProcess = () => {
    const parsed = parseProductLines(rawText, articles, aliases)
    setLines(parsed)
    setUiState(new Map())  // reset UI state em cada processamento
    setError(null)
    setResult(null)
    setStep('preview')
  }

  // ── Step: Preview ───────────────────────────────────────────────────────────

  const handleLineChange = useCallback((id: string, field: keyof ParsedLine, value: string) => {
    setLines(prev => {
      const updated = prev.map(l => {
        if (l.id !== id) return l
        const next = { ...l, [field]: value }
        if (field === 'name') {
          // Utilizador editou o nome no preview → marcar para não aprender alias automático
          next.wasManuallyEdited = true
          const catResult = suggestCategory({ name: value, unit: l.unit })
          next.suggestedCategory   = catResult.category
          next.categoryConfident   = catResult.confident
        }
        if (field === 'category') {
          // Escolha humana = maior confiança que o parser. Limpa borda dashed.
          next.categoryConfident = true
        }
        return next
      })
      if (field === 'name') return recomputeDuplicates(updated, articles)
      return updated
    })
  }, [articles])

  const handleDelete = useCallback((id: string) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, deleted: true } : l))
  }, [])

  const activeLines = lines.filter(l => !l.deleted)

  // Group por nome (primeira ocorrência = primary; resto = variantes)
  const nameToFirstId = new Map<string, string>()
  for (const line of activeLines) {
    const key = normalizeKey(line.name)
    if (line.name.trim() === '') continue
    if (!nameToFirstId.has(key)) {
      nameToFirstId.set(key, line.id)
    }
  }
  const primaryIds   = new Set(nameToFirstId.values())
  const primaryLines = activeLines.filter(l => primaryIds.has(l.id) || l.name.trim() === '')

  const isEffDup     = (l: ParsedLine) => (l.isDuplicate || l.isDuplicateInBatch) && !forcedIds.has(l.id)
  const dupLines     = primaryLines.filter(l => isEffDup(l))
  const partialLines = primaryLines.filter(l =>
    !isEffDup(l) && (l.name.trim() === '' || l.unit.trim() === '')
  )
  const okLines = primaryLines.filter(l =>
    !isEffDup(l) && l.name.trim() !== '' && l.unit.trim() !== ''
  )
  const lowOkLines     = okLines.filter(l => l.confidence === 'low')
  const restOkLines    = okLines.filter(l => l.confidence !== 'low')
  const orderedOkLines = [...lowOkLines, ...restOkLines]
  const ignoredCount   = partialLines.length + dupLines.length

  const handleCreate = async () => {
    setError(null)
    setSaving(true)

    const toCreate = okLines

    // Validar g_per_unit (quando preenchido tem de parsar). Vazio é OK (opcional).
    // Lixo bloqueia para o chef corrigir antes de gravar.
    const gErrs: string[] = []
    for (const line of toCreate) {
      if (line.unit !== 'un') continue
      const ui  = uiState.get(line.id) ?? defaultUiState()
      const raw = ui.gPerUnit.trim()
      if (raw === '') continue
      if (!parsePackagingQuantity(raw, 'g').ok) gErrs.push(line.name)
    }
    if (gErrs.length > 0) {
      setSaving(false)
      setError(`Peso médio por unidade inválido em: ${gErrs.join(', ')}. Edita ou deixa vazio.`)
      return
    }

    const failed: string[] = []
    const results = await Promise.allSettled(
      toCreate.map(async line => {
        const savedName = line.name.trim()
        const unit = line.unit.trim()
        // Guard de defesa em profundidade — UI já restringe via quick-pick.
        if (unit !== 'g' && unit !== 'mL' && unit !== 'un') {
          throw new Error(`Unidade inválida em "${savedName}": ${unit || '(vazio)'} — esperado g, mL ou un.`)
        }

        const ui   = uiState.get(line.id) ?? defaultUiState()
        const opts = lineCountingOptions(line)
        const cm   = opts[Math.min(ui.selectedCountingIdx, opts.length - 1)]
                  ?? getCountingMode({ intent: inferIntent({ unit, supplierSeed: undefined }) })

        // par_level em base unit, derivado do display em counting unit. Mesma
        // multiplicação que o manual (ArticleForm ~linha 1167):
        //   parLevel = parLevelDisplay * countingMode.base_per_unit
        const parTyped = parseFloat(ui.parDisplay)
        const parBase  = !isNaN(parTyped) && parTyped > 0 && cm.base_per_unit > 0
          ? parTyped * cm.base_per_unit
          : 0

        // g_per_unit — só para 'un'; já validado acima
        let gPerValue: number | null = null
        if (unit === 'un' && ui.gPerUnit.trim() !== '') {
          const parsed = parsePackagingQuantity(ui.gPerUnit, 'g')
          if (parsed.ok) gPerValue = parsed.value
        }

        const article = await createArticle({
          name:       savedName,
          unit,
          par_level:  parBase,
          category:   line.category.trim() || undefined,
          g_per_unit: gPerValue,
        })

        // article_size — segue a escolha do toggle (não a deteção do parser).
        // Mesmas guards do manual (ArticleForm ~linha 595-611): só persiste
        // quando count_unit difere de unit base e não é o default da família
        // (kg/L/un genéricos não vão para article_sizes).
        if (
          cm.count_unit !== unit &&
          cm.count_unit !== 'kg' &&
          cm.count_unit !== 'L' &&
          cm.count_unit !== 'un' &&
          cm.base_per_unit > 0
        ) {
          try {
            await createArticleSizeIfMissing(article.id, cm.count_unit, cm.base_per_unit)
          } catch (e) {
            console.error('createArticleSize falhou:', { articleId: article.id, label: cm.count_unit, error: e })
          }
        }

        // Aprender alias só após createArticle bem-sucedido (mesmo invariant que antes).
        // Limitação conhecida deste patch: supplier link NÃO é criado aqui.
        // O fluxo completo (preço + order_unit + conversion_factor) exige 3
        // inputs por linha que tornariam o bulk pesado. Endereçar num patch
        // dedicado de "definir fornecedor em lote".
        maybeLearnAlias(line.originalName, savedName, aliases, learnAlias, line.wasManuallyEdited)

        return article
      })
    )

    results.forEach((r, i) => {
      if (r.status === 'rejected') failed.push(toCreate[i].name)
    })

    setSaving(false)

    if (failed.length === 0) {
      setSuccessCount(toCreate.length)
      onBatchCreated()
      setStep('success')
    } else {
      setResult({ created: toCreate.length - failed.length, failed })
      if (failed.length < toCreate.length) {
        // Criação parcial — atualizar lista mas manter painel aberto
        onBatchCreated()
      }
    }
  }

  const handleContinueAdding = () => {
    setStep('input')
    setRawText('')
    setLines([])
    setUiState(new Map())
    setError(null)
    setResult(null)
    setSuccessCount(0)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          {step === 'preview' && (
            <button
              onClick={() => setStep('input')}
              style={{
                background: 'none',
                border:     'none',
                color:      'var(--text-on-primary-muted)',
                fontSize:   20,
                cursor:     'pointer',
                padding:    0,
                lineHeight: 1,
              }}
            >
              ←
            </button>
          )}
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-on-primary)', margin: 0 }}>
            {step === 'input' ? 'Importar Artigos' : 'Pré-visualização'}
          </h2>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-on-primary-muted)', margin: 0 }}>
          {step === 'input'
            ? 'Cola ou escreve uma lista — um produto por linha.'
            : [
                `${okLines.length} pronto${okLines.length !== 1 ? 's' : ''}`,
                lowOkLines.length > 0 ? `${lowOkLines.length} a confirmar` : null,
                partialLines.length > 0 ? `${partialLines.length} a resolver` : null,
                dupLines.length > 0 ? `${dupLines.length} duplicado${dupLines.length !== 1 ? 's' : ''}` : null,
              ].filter(Boolean).join(' · ')}
        </p>
        {step === 'preview' && (
          <p style={{
            fontSize:   11,
            color:      'var(--text-on-primary-faint)',
            margin:     '6px 0 0',
            lineHeight: 1.5,
            fontStyle:  'italic',
          }}>
            Define o stock mínimo para a Zesto sugerir encomendas. Fornecedor fica para depois.
          </p>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background:   'var(--error-surface)',
          border:       '1px solid var(--error-border)',
          borderRadius: 8,
          padding:      '10px 14px',
          color:        'var(--text-on-primary)',
          fontSize:     13,
          marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {/* Result banner (criação parcial) */}
      {result && result.failed.length > 0 && (
        <div style={{
          background:   'var(--error-surface)',
          border:       '1px solid var(--error-border)',
          borderRadius: 8,
          padding:      '10px 14px',
          color:        'var(--text-on-primary)',
          fontSize:     13,
          marginBottom: 16,
        }}>
          <strong>{result.created} criado{result.created !== 1 ? 's' : ''}.</strong> Falharam: {result.failed.join(', ')}
        </div>
      )}

      {/* Conteúdo */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: 24 }}>

        {step === 'success' && (
          <div style={{
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            justifyContent: 'center',
            gap:            8,
            paddingTop:     48,
            paddingBottom:  48,
          }}>
            <div style={{ fontSize: 32, marginBottom: 8, color: 'var(--success-on-primary)' }}>✓</div>
            <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-on-primary)', margin: 0 }}>
              {successCount} artigo{successCount !== 1 ? 's' : ''} criado{successCount !== 1 ? 's' : ''}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-on-primary-faint)', margin: 0 }}>
              com sucesso
            </p>
          </div>
        )}

        {step === 'input' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={labelStyle}>LISTA DE PRODUTOS</label>
              <p style={{ fontSize: 12, color: 'var(--text-on-primary-faint)', marginBottom: 8, lineHeight: 1.5 }}>
                Exemplo:<br />
                Tomate pelado lata 2.5kg<br />
                Mozzarella fresca 125g<br />
                Natas 1L
              </p>
              <textarea
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                placeholder={'Um produto por linha…\nTomate pelado 2.5kg\nMozzarella fresca 125g'}
                rows={12}
                style={{
                  ...inputStyle,
                  height:     'auto',
                  padding:    '10px 12px',
                  resize:     'vertical',
                  lineHeight: 1.6,
                  fontSize:   15,
                  fontFamily: 'inherit',
                }}
              />
            </div>
            {lineCount > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-on-primary-faint)', margin: 0 }}>
                {lineCount} linha{lineCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}

        {step === 'preview' && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {primaryLines.length === 0 && (
              <p style={{ color: 'var(--text-on-primary-faint)', fontSize: 14, textAlign: 'center', paddingTop: 32 }}>
                Nenhuma linha válida. Volta atrás e revê o texto.
              </p>
            )}

            {okLines.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{
                  fontSize:      11,
                  fontWeight:    700,
                  letterSpacing: '0.1em',
                  color:         'var(--success-on-primary)',
                  marginBottom:  10,
                  paddingTop:    4,
                }}>
                  PRONTOS ({okLines.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {orderedOkLines.map(line => {
                    const ui      = uiState.get(line.id) ?? defaultUiState()
                    const options = lineCountingOptions(line)
                    return (
                      <OkCard
                        key={line.id}
                        line={line}
                        ui={ui}
                        options={options}
                        isForced={forcedIds.has(line.id)}
                        isResolved={justResolvedIds.has(line.id)}
                        onChange={handleLineChange}
                        onDelete={handleDelete}
                        onParChange={handleParChange}
                        onCountingIdxChange={handleCountingIdxChange}
                        onGPerUnitChange={handleGPerUnitChange}
                        onExpandToggle={handleExpandToggle}
                      />
                    )
                  })}
                </div>
              </div>
            )}

            {partialLines.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{
                  fontSize:      11,
                  fontWeight:    700,
                  letterSpacing: '0.1em',
                  color:         'var(--action)',
                  marginBottom:  10,
                }}>
                  A RESOLVER ({partialLines.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {partialLines.map(line => {
                    const ui      = uiState.get(line.id) ?? defaultUiState()
                    const options = lineCountingOptions(line)
                    return (
                      <PartialCard
                        key={line.id}
                        line={line}
                        ui={ui}
                        options={options}
                        onChange={handleLineChange}
                        onDelete={handleDelete}
                        onParChange={handleParChange}
                        onCountingIdxChange={handleCountingIdxChange}
                        onGPerUnitChange={handleGPerUnitChange}
                        onExpandToggle={handleExpandToggle}
                        onResolved={handleResolved}
                      />
                    )
                  })}
                </div>
              </div>
            )}

            {dupLines.length > 0 && (
              <div>
                <div style={{
                  fontSize:       11,
                  fontWeight:     700,
                  letterSpacing:  '0.1em',
                  color:          'var(--text-on-primary-faint)',
                  marginBottom:   10,
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'space-between',
                }}>
                  <span>DUPLICADOS ({dupLines.length})</span>
                  <button
                    onClick={() => handleIgnoreAllDuplicates(dupLines.map(l => l.id))}
                    style={{
                      fontSize:     10,
                      fontWeight:   600,
                      color:        'var(--text-on-primary-faint)',
                      background:   'none',
                      border:       '1px solid var(--border-on-primary)',
                      borderRadius: 4,
                      padding:      '2px 8px',
                      cursor:       'pointer',
                    }}
                  >
                    Ignorar todos
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {dupLines.map(line => (
                    <DuplicateCard
                      key={line.id}
                      line={line}
                      onForceCreate={handleForceCreate}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer com CTAs */}
      <div style={{ paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {step === 'success' && (
          <>
            <button
              onClick={() => router.push('/')}
              style={{
                height:       44,
                borderRadius: 8,
                border:       'none',
                background:   'var(--primary)',
                color:        'var(--text-on-primary)',
                fontSize:     14,
                fontWeight:   600,
                cursor:       'pointer',
              }}
            >
              Ir para inventário
            </button>
            <button
              onClick={handleContinueAdding}
              style={{
                height:       44,
                borderRadius: 8,
                border:       'none',
                background:   'none',
                color:        'var(--text-on-primary-muted)',
                fontSize:     13,
                cursor:       'pointer',
              }}
            >
              Continuar a adicionar
            </button>
          </>
        )}

        {step === 'input' && (
          <>
            <button
              onClick={handleProcess}
              disabled={lineCount === 0}
              style={{
                height:       44,
                borderRadius: 8,
                border:       'none',
                background:   lineCount === 0 ? 'var(--action-disabled)' : 'var(--action)',
                color:        lineCount === 0 ? 'var(--text-on-primary-faint)' : 'var(--text-on-primary)',
                fontSize:     14,
                fontWeight:   600,
                cursor:       lineCount === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              Processar lista{lineCount > 0 ? ` (${lineCount})` : ''}
            </button>
            <button
              onClick={onCancel}
              style={{
                height:       44,
                borderRadius: 8,
                border:       'none',
                background:   'none',
                color:        'var(--text-on-primary-muted)',
                fontSize:     13,
                cursor:       'pointer',
              }}
            >
              Cancelar
            </button>
          </>
        )}

        {step === 'preview' && (
          <>
            <button
              onClick={handleCreate}
              disabled={saving || okLines.length === 0}
              style={{
                height:       44,
                borderRadius: 8,
                border:       'none',
                background:   saving || okLines.length === 0 ? 'var(--action-disabled)' : 'var(--action)',
                color:        saving || okLines.length === 0 ? 'var(--text-on-primary-faint)' : 'var(--text-on-primary)',
                fontSize:     14,
                fontWeight:   600,
                cursor:       saving ? 'wait' : okLines.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'A criar…' : `Criar ${okLines.length} artigo${okLines.length !== 1 ? 's' : ''}`}
            </button>
            {!saving && ignoredCount > 0 && (
              <p style={{
                fontSize:  11,
                color:     'var(--text-on-primary-faint)',
                textAlign: 'center',
                margin:    0,
              }}>
                {ignoredCount} ignorado{ignoredCount !== 1 ? 's' : ''}
                {partialLines.length > 0 && dupLines.length > 0
                  ? ` (${partialLines.length} incompleto${partialLines.length !== 1 ? 's' : ''} · ${dupLines.length} duplicado${dupLines.length !== 1 ? 's' : ''})`
                  : ''}
              </p>
            )}
            <button
              onClick={onCancel}
              disabled={saving}
              style={{
                height:       44,
                borderRadius: 8,
                border:       'none',
                background:   'none',
                color:        'var(--text-on-primary-muted)',
                fontSize:     13,
                cursor:       saving ? 'not-allowed' : 'pointer',
              }}
            >
              Cancelar
            </button>
          </>
        )}
      </div>
    </div>
  )
}
