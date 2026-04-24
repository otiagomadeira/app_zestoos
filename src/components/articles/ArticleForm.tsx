'use client'

import { useState, useEffect } from 'react'
import type { Article, Supplier } from '@/types/database'
import {
  createArticle, updateArticle, toggleArticleActive,
  fetchAllSuppliers, fetchArticleSuppliers, saveArticleSuppliers,
} from '@/lib/supabase'
import { KITCHEN_UNITS } from '@/lib/units'
import { suggestCategory } from '@/lib/categoryKeywords'

interface Props {
  existing?: Article
  onSaved:   (article: Article) => void
  onCancel:  () => void
}

type LinkRow = {
  key:                  string
  supplier_id:          string
  supplier_ref:         string
  price:                string
  order_unit:           string
  conversion_factor:    string
  base_per_order_unit:  string
  is_preferred:         boolean
}

let _key = 0
const nextKey = () => String(++_key)
const emptyLink = (): LinkRow => ({
  key:                  nextKey(),
  supplier_id:          '',
  supplier_ref:         '',
  price:                '',
  order_unit:           '',
  conversion_factor:    '1',
  base_per_order_unit:  '',
  is_preferred:         false,
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

const cellInput: React.CSSProperties = {
  width:        '100%',
  height:       44,
  background:   'var(--bg)',
  border:       '1px solid var(--border)',
  borderRadius: 6,
  padding:      '0 8px',
  color:        'var(--text)',
  fontSize:     13,
  outline:      'none',
}

export default function ArticleForm({ existing, onSaved, onCancel }: Props) {
  const isEdit = !!existing

  const [name,       setName]      = useState(existing?.name       ?? '')
  const [category,   setCategory]  = useState(existing?.category   ?? '')
  const [unit,       setUnit]      = useState(existing?.unit       ?? '')
  const [stockUnit,  setStockUnit] = useState(existing?.stock_unit ?? '')
  const [parLevel,   setParLevel]  = useState(existing ? String(existing.par_level) : '')
  const [links,     setLinks]     = useState<LinkRow[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    fetchAllSuppliers()
      .then(sups => setSuppliers(sups.filter(s => s.is_active)))
      .catch(() => {})

    if (existing) {
      fetchArticleSuppliers(existing.id)
        .then(rows => setLinks(rows.map(r => ({
          key:                  nextKey(),
          supplier_id:          r.supplier_id,
          supplier_ref:         r.supplier_ref ?? '',
          price:                String(r.price),
          order_unit:           r.order_unit,
          conversion_factor:    String(r.conversion_factor),
          base_per_order_unit:  r.base_per_order_unit != null ? String(r.base_per_order_unit) : '',
          is_preferred:         r.is_preferred,
        }))))
        .catch(() => {})
    }
  }, [existing])

  const updateLink = (key: string, partial: Partial<LinkRow>) =>
    setLinks(prev => prev.map(l => l.key === key ? { ...l, ...partial } : l))

  const setPreferred = (key: string) =>
    setLinks(prev => prev.map(l => ({ ...l, is_preferred: l.key === key })))

  const removeLink = (key: string) =>
    setLinks(prev => prev.filter(l => l.key !== key))

  const handleSave = async () => {
    if (!name.trim()) return setError('Nome é obrigatório')
    if (!unit.trim()) return setError('Unidade base é obrigatória')
    const par = parseFloat(parLevel)
    if (isNaN(par) || par < 0) return setError('Par level inválido')

    const validLinks = links.filter(l =>
      l.supplier_id && parseFloat(l.price) > 0 && l.order_unit.trim()
    )

    setSaving(true)
    setError(null)
    try {
      // stock_unit: guardar null se igual à base unit ou vazio
      const stockUnitTrimmed = stockUnit.trim()
      const stockUnitSave = (stockUnitTrimmed && stockUnitTrimmed !== unit.trim())
        ? stockUnitTrimmed
        : null

      const input = {
        name:       name.trim(),
        unit:       unit.trim(),
        stock_unit: stockUnitSave,
        par_level:  par,
        category:   category.trim() || undefined,
      }

      let saved: Article
      if (isEdit && existing) {
        await updateArticle(existing.id, input)
        saved = { ...existing, ...input } as Article
      } else {
        saved = await createArticle(input)
      }

      await saveArticleSuppliers(saved.id, validLinks.map((l) => ({
        supplier_id:          l.supplier_id,
        supplier_ref:         l.supplier_ref.trim() || null,
        price:                parseFloat(l.price),
        order_unit:           l.order_unit.trim(),
        conversion_factor:    parseFloat(l.conversion_factor) || 1,
        base_per_order_unit:  l.base_per_order_unit.trim() ? parseFloat(l.base_per_order_unit) : null,
        // if only one link, always preferred; otherwise respect user choice
        is_preferred:         validLinks.length === 1 ? true : l.is_preferred,
      })))

      onSaved(saved)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async () => {
    if (!existing) return
    setSaving(true)
    setError(null)
    try {
      await toggleArticleActive(existing.id, !existing.is_active)
      onSaved({ ...existing, is_active: !existing.is_active })
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao alterar estado')
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
          {isEdit ? 'EDITAR ARTIGO' : 'NOVO ARTIGO'}
        </p>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-on-primary)' }}>
          {isEdit ? existing.name : 'Novo Artigo'}
        </h3>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Name */}
        <div>
          <label style={labelStyle}>NOME</label>
          <input type="text" placeholder="ex: Mel Silvestre" value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
        </div>

        {/* Category */}
        <div>
          <label style={labelStyle}>CATEGORIA (opcional)</label>
          <input type="text" placeholder="ex: Lacticínios, Carnes, Secos…" value={category} onChange={e => setCategory(e.target.value)} style={inputStyle} />
          {(() => {
            const suggestion = category.trim() === '' ? suggestCategory(name, unit) : null
            if (!suggestion) return null
            return (
              <button
                type="button"
                onClick={() => setCategory(suggestion)}
                style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--warning-surface)', border: `1px solid var(--warning-border)`, borderRadius: 6, padding: '3px 10px', color: 'var(--text-on-primary-muted)', fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', cursor: 'pointer' }}
              >
                Sugestão: {suggestion} → aplicar
              </button>
            )
          })()}
        </div>

        {/* Unit + Stock Unit */}
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>UNIDADE BASE</label>
            <input
              list="units-article-base"
              placeholder="ex: g, kg, L, un"
              value={unit}
              onChange={e => setUnit(e.target.value)}
              style={inputStyle}
            />
            <datalist id="units-article-base">
              {KITCHEN_UNITS.map(u => <option key={u} value={u} />)}
            </datalist>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>UNIDADE DE STOCK</label>
            <input
              list="units-article-stock"
              placeholder="ex: saco, molho (opcional)"
              value={stockUnit}
              onChange={e => setStockUnit(e.target.value)}
              style={inputStyle}
            />
            <datalist id="units-article-stock">
              {KITCHEN_UNITS.map(u => <option key={u} value={u} />)}
              {['saco', 'molho', 'maço', 'garrafa', 'garrafão', 'lata', 'caixa', 'ramo', 'dente'].map(u =>
                <option key={u} value={u} />
              )}
            </datalist>
          </div>
        </div>

        {/* Par Level */}
        <div>
          <label style={labelStyle}>
            PAR LEVEL (em {(stockUnit.trim() && stockUnit.trim() !== unit.trim()) ? stockUnit.trim() : (unit.trim() || 'unidade')})
          </label>
          <input
            type="number"
            min="0"
            step="any"
            placeholder="ex: 5"
            value={parLevel}
            onChange={e => setParLevel(e.target.value)}
            style={{ ...inputStyle, width: '50%' }}
          />
        </div>

        {/* Supplier links */}
        <div>
          <p style={{ fontSize: 11, color: 'var(--text-on-primary-subtle)', letterSpacing: '0.08em', marginBottom: 8 }}>
            FORNECEDORES
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {links.map(link => (
              <div
                key={link.key}
                style={{
                  background:    'var(--surface)',
                  border:        '1px solid var(--border)',
                  borderRadius:  10,
                  padding:       '10px 12px',
                  display:       'flex',
                  flexDirection: 'column',
                  gap:           8,
                }}
              >
                {/* Supplier select + delete */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    value={link.supplier_id}
                    onChange={e => updateLink(link.key, { supplier_id: e.target.value })}
                    style={{ flex: 1, height: 44, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13, padding: '0 8px', outline: 'none', cursor: 'pointer' }}
                  >
                    <option value="">Selecionar fornecedor…</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button
                    onClick={() => removeLink(link.key)}
                    style={{ width: 44, height: 44, borderRadius: 6, border: `1px solid var(--error-border)`, background: 'var(--error-surface)', color: 'var(--error)', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >×</button>
                </div>

                {/* Price + Order unit + Conversion factor + Base per order */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: 'var(--text-subtle)', display: 'block', marginBottom: 2 }}>PREÇO (€)</label>
                    <input
                      type="number" min="0" step="any" placeholder="0.00"
                      value={link.price}
                      onChange={e => updateLink(link.key, { price: e.target.value })}
                      style={cellInput}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: 'var(--text-subtle)', display: 'block', marginBottom: 2 }}>UN. COMPRA</label>
                    <input
                      list={`units-order-link-${link.key}`}
                      placeholder="ex: saco"
                      value={link.order_unit}
                      onChange={e => updateLink(link.key, { order_unit: e.target.value })}
                      style={cellInput}
                    />
                    <datalist id={`units-order-link-${link.key}`}>
                      {KITCHEN_UNITS.map(u => <option key={u} value={u} />)}
                    </datalist>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: 'var(--text-subtle)', display: 'block', marginBottom: 2 }}>FATOR</label>
                    <input
                      type="number" min="0.01" step="any" placeholder="1"
                      value={link.conversion_factor}
                      onChange={e => updateLink(link.key, { conversion_factor: e.target.value })}
                      style={cellInput}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: 'var(--text-subtle)', display: 'block', marginBottom: 2 }}>
                      BASE/ENC. ({unit.trim() || '?'})
                    </label>
                    <input
                      type="number" min="0" step="any"
                      placeholder={`ex: ${unit.trim() === 'g' ? '200' : unit.trim() === 'mL' ? '1000' : '1'}`}
                      value={link.base_per_order_unit}
                      onChange={e => updateLink(link.key, { base_per_order_unit: e.target.value })}
                      style={cellInput}
                    />
                  </div>
                </div>

                {/* Ref + Preferred */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Ref. fornecedor (opcional)"
                    value={link.supplier_ref}
                    onChange={e => updateLink(link.key, { supplier_ref: e.target.value })}
                    style={{ ...cellInput, flex: 1 }}
                  />
                  <button
                    onClick={() => setPreferred(link.key)}
                    style={{
                      height:        44,
                      padding:       '0 10px',
                      borderRadius:  6,
                      flexShrink:    0,
                      border:        link.is_preferred
                        ? '1px solid var(--success-border)'
                        : `1px solid var(--border)`,
                      background:    link.is_preferred ? 'var(--success-surface)' : 'transparent',
                      color:         link.is_preferred ? 'var(--success)' : 'var(--text-subtle)',
                      fontSize:      11,
                      fontWeight:    600,
                      cursor:        'pointer',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {link.is_preferred ? '★ PREFERIDO' : '☆ PREFERIDO'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setLinks(prev => [...prev, emptyLink()])}
            style={{ width: '100%', height: 44, marginTop: 8, borderRadius: 8, border: `1px dashed var(--border-on-primary-medium)`, background: 'transparent', color: 'var(--text-on-primary-muted)', fontSize: 13, cursor: 'pointer' }}
          >
            + Adicionar Fornecedor
          </button>
        </div>

        {/* Deactivate */}
        {isEdit && (
          <div style={{ paddingTop: 16, borderTop: `1px solid var(--border-on-primary-soft)` }}>
            <button
              onClick={handleToggleActive}
              disabled={saving}
              style={{
                width:        '100%',
                height:       44,
                borderRadius: 8,
                border:       existing.is_active
                  ? `1px solid var(--error-border)`
                  : '1px solid var(--success-border)',
                background:   existing.is_active
                  ? 'var(--error-surface)'
                  : 'var(--success-surface)',
                color:        existing.is_active ? 'var(--error)' : 'var(--success)',
                fontSize:     13,
                fontWeight:   600,
                cursor:       'pointer',
              }}
            >
              {existing.is_active ? 'Desativar Artigo' : 'Reativar Artigo'}
            </button>
          </div>
        )}

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
          style={{ flex: 2, height: 48, borderRadius: 10, border: 'none', background: 'var(--action)', color: 'var(--text-on-primary)', fontSize: 15, fontWeight: 600, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}
        >
          {saving ? 'A guardar…' : isEdit ? 'Guardar Alterações' : 'Guardar Artigo'}
        </button>
      </div>
    </div>
  )
}
