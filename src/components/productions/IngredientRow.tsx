'use client'

import type { Article, Production } from '@/types/database'
import { KITCHEN_UNITS } from '@/lib/units'
import { convertUnit } from '@/lib/supabase'

export type IngredientType = 'article' | 'production'

export interface IngredientRowValue {
  type:               IngredientType
  article_id:         string
  sub_production_id:  string
  quantity:           string
  unit:               string
  yield_factor:       string
}

interface Props {
  value:       IngredientRowValue
  index:       number
  articles:    Article[]
  productions: Production[]
  conversions: Map<string, Map<string, number>>
  onChange:    (index: number, value: IngredientRowValue) => void
  onRemove:    (index: number) => void
}

const inputStyle: React.CSSProperties = {
  background:   'var(--bg)',
  border:       '1px solid var(--border)',
  borderRadius: 6,
  color:        'var(--text)',
  fontSize:     13,
  outline:      'none',
  height:       44,
  padding:      '0 8px',
}

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
  width:  '100%',
}

export default function IngredientRow({ value, index, articles, productions, conversions, onChange, onRemove }: Props) {
  const update = (partial: Partial<IngredientRowValue>) =>
    onChange(index, { ...value, ...partial })

  const handleTypeChange = (type: IngredientType) => {
    update({ type, article_id: '', sub_production_id: '', unit: '' })
  }

  const handleArticleChange = (articleId: string) => {
    const art = articles.find(a => a.id === articleId)
    update({ article_id: articleId, unit: art?.unit ?? '' })
  }

  const handleProductionChange = (prodId: string) => {
    const prod = productions.find(p => p.id === prodId)
    update({ sub_production_id: prodId, unit: prod?.yield_unit ?? '' })
  }

  // Determine base unit of selected item
  const baseUnit: string | null = (() => {
    if (value.type === 'article' && value.article_id) {
      return articles.find(a => a.id === value.article_id)?.unit ?? null
    }
    if (value.type === 'production' && value.sub_production_id) {
      return productions.find(p => p.id === value.sub_production_id)?.yield_unit ?? null
    }
    return null
  })()

  // Conversion hint
  const conversionHint: string | null = (() => {
    if (!baseUnit || !value.unit || value.unit === baseUnit) return null
    const qty = parseFloat(value.quantity)
    if (isNaN(qty) || qty <= 0) return null
    const converted = convertUnit(qty, value.unit, baseUnit, conversions)
    if (converted == null) return null
    const rounded = converted < 0.001
      ? converted.toExponential(2)
      : converted < 1
        ? converted.toFixed(4).replace(/\.?0+$/, '')
        : converted % 1 === 0
          ? converted.toFixed(0)
          : converted.toFixed(3).replace(/\.?0+$/, '')
    return `≈ ${rounded} ${baseUnit}`
  })()

  return (
    <div style={{
      background:   'var(--surface)',
      border:       '1px solid var(--border)',
      borderRadius: 10,
      padding:      '10px 12px',
      display:      'flex',
      flexDirection: 'column',
      gap:          8,
    }}>
      {/* Tipo + selector */}
      <div style={{ display: 'flex', gap: 8 }}>
        {/* Tipo toggle */}
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: `1px solid var(--border)`, flexShrink: 0 }}>
          {(['article', 'production'] as IngredientType[]).map(t => (
            <button
              key={t}
              onClick={() => handleTypeChange(t)}
              style={{
                height:     44,
                padding:    '0 10px',
                border:     'none',
                background: value.type === t ? 'var(--primary)' : 'transparent',
                color:      value.type === t ? 'var(--text-on-primary)' : 'var(--text-subtle)',
                fontSize:   11,
                fontWeight: 600,
                cursor:     'pointer',
                letterSpacing: '0.03em',
              }}
            >
              {t === 'article' ? 'ARTIGO' : 'PRODUÇÃO'}
            </button>
          ))}
        </div>

        {/* Selector */}
        <div style={{ flex: 1 }}>
          {value.type === 'article' ? (
            <select
              value={value.article_id}
              onChange={e => handleArticleChange(e.target.value)}
              style={selectStyle}
            >
              <option value="">Selecionar artigo…</option>
              {articles.map(a => (
                <option key={a.id} value={a.id}>{a.name} ({a.unit})</option>
              ))}
            </select>
          ) : (
            <select
              value={value.sub_production_id}
              onChange={e => handleProductionChange(e.target.value)}
              style={selectStyle}
            >
              <option value="">Selecionar produção…</option>
              {productions.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.yield_unit})</option>
              ))}
            </select>
          )}
        </div>

        {/* Remover */}
        <button
          onClick={() => onRemove(index)}
          style={{
            width:        44,
            height:       44,
            borderRadius: 6,
            border:       `1px solid var(--error-border)`,
            background:   'var(--error-surface)',
            color:        'var(--error)',
            fontSize:     16,
            cursor:       'pointer',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            flexShrink:   0,
          }}
        >
          ×
        </button>
      </div>

      {/* Qty + Unit + Yield */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 2 }}>
          <label style={{ fontSize: 10, color: 'var(--text-subtle)', letterSpacing: '0.05em' }}>QUANTIDADE</label>
          <input
            type="number"
            min="0"
            step="any"
            placeholder="0"
            value={value.quantity}
            onChange={e => update({ quantity: e.target.value })}
            style={{ ...inputStyle, width: '100%' }}
          />
          {conversionHint && (
            <span style={{ fontSize: 10, color: 'var(--text-subtle)', fontFamily: 'JetBrains Mono, monospace', marginTop: 1 }}>
              {conversionHint}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          <label style={{ fontSize: 10, color: 'var(--text-subtle)', letterSpacing: '0.05em' }}>UNIDADE</label>
          <input
            list={`units-ingredient-${index}`}
            placeholder="kg"
            value={value.unit}
            onChange={e => update({ unit: e.target.value })}
            style={{ ...inputStyle, width: '100%' }}
          />
          <datalist id={`units-ingredient-${index}`}>
            {KITCHEN_UNITS.map(u => <option key={u} value={u} />)}
          </datalist>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 2 }}>
          <label style={{ fontSize: 10, color: 'var(--text-subtle)', letterSpacing: '0.05em' }}>RENDIMENTO (0–1)</label>
          <input
            type="number"
            min="0.01"
            max="1"
            step="0.01"
            placeholder="1.00"
            value={value.yield_factor}
            onChange={e => update({ yield_factor: e.target.value })}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
      </div>
    </div>
  )
}
