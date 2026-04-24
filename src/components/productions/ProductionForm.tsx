'use client'

import { useState, useEffect } from 'react'
import type { Article, Production, ProductionDetail } from '@/types/database'
import { fetchArticles, fetchProductionsList, createProduction, updateProduction, fetchUnitConversions, convertUnit } from '@/lib/supabase'
import { KITCHEN_UNITS } from '@/lib/units'
import IngredientRow, { type IngredientRowValue } from './IngredientRow'

interface Props {
  existing?: ProductionDetail   // se presente → modo edição
  onSaved:   (prod: Production) => void
  onCancel:  () => void
}

const EMPTY_INGREDIENT = (): IngredientRowValue => ({
  type:              'article',
  article_id:        '',
  sub_production_id: '',
  quantity:          '',
  unit:              '',
  yield_factor:      '1',
})

const labelStyle: React.CSSProperties = {
  fontSize:      11,
  color:         'var(--text-on-primary-muted)',
  letterSpacing: '0.06em',
  marginBottom:  4,
  display:       'block',
}

const inputStyle: React.CSSProperties = {
  width:        '100%',
  height:       40,
  background:   'var(--bg)',
  border:       '1px solid var(--border)',
  borderRadius: 8,
  padding:      '0 12px',
  color:        'var(--text)',
  fontSize:     14,
  outline:      'none',
}

export default function ProductionForm({ existing, onSaved, onCancel }: Props) {
  const isEdit = !!existing

  const [name,        setName]        = useState(existing?.name        ?? '')
  const [yieldQty,    setYieldQty]    = useState(existing ? String(existing.yield_qty) : '')
  const [yieldUnit,   setYieldUnit]   = useState(existing?.yield_unit  ?? '')
  const [notes,       setNotes]       = useState(existing?.notes       ?? '')
  const [preparation, setPreparation] = useState(existing?.preparation ?? '')
  const [ingredients, setIngredients] = useState<IngredientRowValue[]>(() => {
    if (existing?.ingredients.length) {
      return existing.ingredients.map(i => ({
        type:              i.sub_production_id ? 'production' : 'article',
        article_id:        i.article_id        ?? '',
        sub_production_id: i.sub_production_id ?? '',
        quantity:          String(i.quantity),
        unit:              i.unit,
        yield_factor:      String(i.yield_factor),
      } as IngredientRowValue))
    }
    return [EMPTY_INGREDIENT()]
  })

  const [articles,    setArticles]    = useState<Article[]>([])
  const [productions, setProductions] = useState<Production[]>([])
  const [conversions, setConversions] = useState<Map<string, Map<string, number>>>(new Map())
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchArticles(), fetchProductionsList(), fetchUnitConversions()])
      .then(([arts, prods, convs]) => {
        setArticles(arts)
        setConversions(convs)
        // exclude self when editing
        setProductions(existing ? prods.filter(p => p.id !== existing.id) : prods)
      })
      .catch(() => {})
  }, [existing])

  const addIngredient = () => setIngredients(prev => [...prev, EMPTY_INGREDIENT()])

  const updateIngredient = (index: number, value: IngredientRowValue) =>
    setIngredients(prev => prev.map((ing, i) => i === index ? value : ing))

  const removeIngredient = (index: number) =>
    setIngredients(prev => prev.filter((_, i) => i !== index))

  const handleSave = async () => {
    if (!name.trim())      return setError('Nome é obrigatório')
    if (!yieldQty.trim())  return setError('Quantidade de yield é obrigatória')
    if (!yieldUnit.trim()) return setError('Unidade de yield é obrigatória')
    const qty = parseFloat(yieldQty)
    if (isNaN(qty) || qty <= 0) return setError('Quantidade de yield inválida')

    const validIngredients = ingredients.filter(i => {
      const hasRef = i.type === 'article' ? !!i.article_id : !!i.sub_production_id
      return hasRef && parseFloat(i.quantity) > 0
    })

    const payload = {
      name:        name.trim(),
      yield_qty:   qty,
      yield_unit:  yieldUnit.trim(),
      notes:       notes.trim()       || undefined,
      preparation: preparation.trim() || undefined,
      ingredients: validIngredients.map((i, idx) => {
        const rawQty   = parseFloat(i.quantity)
        const baseUnit = i.type === 'article'
          ? articles.find(a => a.id === i.article_id)?.unit ?? i.unit
          : productions.find(p => p.id === i.sub_production_id)?.yield_unit ?? i.unit
        // Convert to base unit if a known conversion exists
        const finalQty  = convertUnit(rawQty, i.unit, baseUnit, conversions) ?? rawQty
        const finalUnit = (convertUnit(rawQty, i.unit, baseUnit, conversions) != null) ? baseUnit : i.unit
        return {
          article_id:        i.type === 'article'    ? i.article_id        : undefined,
          sub_production_id: i.type === 'production' ? i.sub_production_id : undefined,
          quantity:          finalQty,
          unit:              finalUnit,
          yield_factor:      parseFloat(i.yield_factor) || 1,
          sort_order:        idx,
        }
      }),
    }

    setSaving(true)
    setError(null)
    try {
      if (isEdit && existing) {
        await updateProduction(existing.id, payload)
        onSaved({ ...existing, ...payload } as Production)
      } else {
        const prod = await createProduction(payload)
        onSaved(prod)
      }
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ marginBottom: 20, flexShrink: 0 }}>
        <button
          onClick={onCancel}
          style={{ background: 'none', border: 'none', color: 'var(--text-on-primary-muted)', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12 }}
        >
          ← Cancelar
        </button>
        <p style={{ fontSize: 11, color: 'var(--text-on-primary-subtle)', letterSpacing: '0.08em', marginBottom: 4 }}>
          {isEdit ? 'EDITAR FICHA' : 'NOVA FICHA'}
        </p>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-on-primary)' }}>
          {isEdit ? 'Editar Ficha Técnica' : 'Criar Ficha Técnica'}
        </h3>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Nome */}
        <div>
          <label style={labelStyle}>NOME</label>
          <input type="text" placeholder="ex: Molho Bechamel" value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
        </div>

        {/* Yield */}
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>QUANTIDADE QUE RENDE</label>
            <input type="number" min="0" step="any" placeholder="ex: 2" value={yieldQty} onChange={e => setYieldQty(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>UNIDADE</label>
            <input
              list="units-yield"
              placeholder="ex: kg, L, dose"
              value={yieldUnit}
              onChange={e => setYieldUnit(e.target.value)}
              style={inputStyle}
            />
            <datalist id="units-yield">
              {KITCHEN_UNITS.map(u => <option key={u} value={u} />)}
            </datalist>
          </div>
        </div>

        {/* Notas */}
        <div>
          <label style={labelStyle}>NOTAS (opcional)</label>
          <input type="text" placeholder="Observações…" value={notes} onChange={e => setNotes(e.target.value)} style={inputStyle} />
        </div>

        {/* Modo de preparação */}
        <div>
          <label style={labelStyle}>MODO DE PREPARAÇÃO (opcional)</label>
          <textarea
            placeholder="Descreve os passos de preparação…"
            value={preparation}
            onChange={e => setPreparation(e.target.value)}
            rows={4}
            style={{
              ...inputStyle,
              height:    'auto',
              padding:   '10px 12px',
              resize:    'vertical',
              lineHeight: 1.5,
            }}
          />
        </div>

        {/* Ingredientes */}
        <div>
          <p style={{ fontSize: 11, color: 'var(--text-on-primary-subtle)', letterSpacing: '0.08em', marginBottom: 8 }}>INGREDIENTES</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ingredients.map((ing, idx) => (
              <IngredientRow
                key={idx}
                index={idx}
                value={ing}
                articles={articles}
                productions={productions}
                conversions={conversions}
                onChange={updateIngredient}
                onRemove={removeIngredient}
              />
            ))}
          </div>
          <button
            onClick={addIngredient}
            style={{
              width: '100%', height: 44, marginTop: 8,
              borderRadius: 8, border: `1px dashed var(--border-on-primary-medium)`,
              background: 'transparent', color: 'var(--text-on-primary-muted)',
              fontSize: 13, cursor: 'pointer',
            }}
          >
            + Adicionar Ingrediente
          </button>
        </div>

        {error && (
          <div style={{ background: 'var(--error-surface)', border: `1px solid var(--error-border)`, borderRadius: 8, padding: '10px 14px', color: 'var(--error-on-primary)', fontSize: 13 }}>
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ paddingTop: 16, borderTop: `1px solid var(--border-on-primary-soft)`, marginTop: 16, display: 'flex', gap: 10, flexShrink: 0 }}>
        <button
          onClick={onCancel}
          style={{ flex: 1, height: 48, borderRadius: 10, border: `1px solid var(--border-on-primary)`, background: 'transparent', color: 'var(--text-on-primary-muted)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
        >
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ flex: 2, height: 48, borderRadius: 10, border: 'none', background: 'var(--action)', color: 'var(--text-on-primary)', fontSize: 15, fontWeight: 600, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1, letterSpacing: '0.02em' }}
        >
          {saving ? 'A guardar…' : isEdit ? 'Guardar Alterações' : 'Guardar Ficha'}
        </button>
      </div>
    </div>
  )
}
