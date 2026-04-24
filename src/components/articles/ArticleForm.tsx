'use client'

import { useState, useEffect, useRef } from 'react'
import type { Article, Supplier } from '@/types/database'
import {
  createArticle, updateArticle, toggleArticleActive,
  fetchAllSuppliers, fetchArticleSuppliers, saveArticleSuppliers,
} from '@/lib/supabase'
import { ORDER_UNITS } from '@/lib/units'
import { ARTICLE_CATEGORIES, suggestCategory } from '@/lib/categoryKeywords'
import { maybeLearnAlias, normalizeKey } from '@/lib/ingredientDictionary'
import { normalizeArticleInput } from '@/lib/normalizeArticle'
import { parseArticleInput, type ParsedArticleInput } from '@/lib/parseArticleInput'
import { useOrgAliases } from '@/hooks/useOrgAliases'

interface Props {
  existing?:  Article
  articles?:  Article[]   // lista para deteção de duplicados client-side
  onSaved:    (article: Article) => void
  onCancel:   () => void
}

type LinkRow = {
  key:               string
  supplier_id:       string
  supplier_ref:      string
  price:             string
  order_unit:        string
  conversion_factor: string
  is_preferred:      boolean
}


let _key = 0
const nextKey = () => String(++_key)
const emptyLink = (): LinkRow => ({
  key:               nextKey(),
  supplier_id:       '',
  supplier_ref:      '',
  price:             '',
  order_unit:        '',
  conversion_factor: '1',
  is_preferred:      false,
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

export default function ArticleForm({ existing, articles, onSaved, onCancel }: Props) {
  const isEdit = !!existing

  const [name,               setName]              = useState(existing?.name     ?? '')
  const [category,           setCategory]          = useState(existing?.category ?? '')
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)
  const [unit,               setUnit]              = useState(existing?.unit     ?? '')
  const [parLevel,           setParLevel]          = useState(existing ? String(existing.par_level) : '')
  const [links,              setLinks]             = useState<LinkRow[]>([])
  const [suppliers,          setSuppliers]         = useState<Supplier[]>([])
  const [expandedLinks,      setExpandedLinks]     = useState<Set<string>>(new Set())
  const [saving,             setSaving]            = useState(false)
  const [error,              setError]             = useState<string | null>(null)
  const [isDirty,            setIsDirty]           = useState(false)
  const [duplicateWarning,   setDuplicateWarning]  = useState<string | null>(null)
  const [parsedHint,         setParsedHint]         = useState<ParsedArticleInput | null>(null)

  const { aliases, learnAlias } = useOrgAliases()
  const rawNameRef             = useRef(existing?.name ?? '')
  // true se o utilizador editou o nome depois da última normalização automática
  const nameChangedAfterBlurRef = useRef(false)

  const handleNameBlur = () => {
    setParsedHint(null)
    if (!name.trim()) return

    // Pipeline única — normaliza nome, infere unidade e categoria
    const normalized = normalizeArticleInput(name, aliases)

    // Normalizar nome (sempre — preserva escolha do utilizador via DICT/aliases)
    setName(normalized.name)
    // Bloco de normalização correu — reset do flag de edição manual
    nameChangedAfterBlurRef.current = false

    // Preencher campos vazios (nunca sobrescrever escolhas conscientes)
    if (!isEdit) {
      if (category.trim() === '' && normalized.category) setCategory(normalized.category)
      if (unit.trim() === '') setUnit(normalized.unit)
    }

    // Deteção de duplicados (só para artigos novos)
    if (!isEdit && articles) {
      const key = normalized.normalizedKey
      const dup = articles.find(a => normalizeKey(a.name) === key)
      setDuplicateWarning(dup ? `Artigo semelhante já existe: "${dup.name}"` : null)
    }
  }

  useEffect(() => {
    fetchAllSuppliers()
      .then(sups => setSuppliers(sups.filter(s => s.is_active)))
      .catch(() => {})

    if (existing) {
      fetchArticleSuppliers(existing.id)
        .then(rows => setLinks(rows.map(r => ({
          key:               nextKey(),
          supplier_id:       r.supplier_id,
          supplier_ref:      r.supplier_ref ?? '',
          price:             String(r.price),
          order_unit:        r.order_unit,
          conversion_factor: String(r.conversion_factor),
          is_preferred:      r.is_preferred,
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
      const normalized = normalizeArticleInput(name.trim(), aliases)
      const input = {
        name:      normalized.name,
        unit:      unit.trim(),
        par_level: par,
        category:  category.trim() || undefined,
      }

      let saved: Article
      if (isEdit && existing) {
        await updateArticle(existing.id, input)
        saved = { ...existing, ...input } as Article
      } else {
        saved = await createArticle(input)
      }

      await saveArticleSuppliers(saved.id, validLinks.map((l) => ({
        supplier_id:       l.supplier_id,
        supplier_ref:      l.supplier_ref.trim() || null,
        price:             parseFloat(l.price),
        order_unit:        l.order_unit.trim(),
        conversion_factor: parseFloat(l.conversion_factor) || 1,
        is_preferred:      validLinks.length === 1 ? true : l.is_preferred,
      })))

      maybeLearnAlias(
        rawNameRef.current,
        input.name,
        aliases,
        learnAlias,
        nameChangedAfterBlurRef.current,
      )

      setIsDirty(false)
      onSaved(saved)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async () => {
    if (!existing) return
    if (existing.is_active && !confirm(`Desativar "${existing.name}"? O artigo deixa de aparecer nas sugestões de encomenda.`)) return
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

  const handleCancel = () => {
    if (isDirty && !confirm('Tens alterações não guardadas. Sair na mesma?')) return
    onCancel()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ marginBottom: 20, flexShrink: 0 }}>
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
          <input
            type="text"
            placeholder="ex: Mel Silvestre"
            value={name}
            autoFocus={!isEdit}
            onChange={e => {
              const val = e.target.value
              setName(val)
              rawNameRef.current = val
              nameChangedAfterBlurRef.current = true
              setIsDirty(true)
              if (duplicateWarning) setDuplicateWarning(null)
              // Hint de parsing em tempo real
              const parsed = parseArticleInput(val)
              const hasExtracted =
                parsed.detected_qty != null ||
                parsed.detected_unit != null ||
                parsed.detected_packaging != null
              setParsedHint(hasExtracted ? parsed : null)
            }}
            onBlur={handleNameBlur}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim() && unit.trim()) handleSave() }}
            style={inputStyle}
          />
          {duplicateWarning && (
            <p style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>
              {duplicateWarning}
            </p>
          )}
          {parsedHint && !duplicateWarning && (
            <p style={{
              fontSize:   11,
              color:      'var(--text-muted)',
              marginTop:  4,
              lineHeight: 1.4,
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {[
                parsedHint.detected_qty != null && parsedHint.detected_unit
                  ? `${parsedHint.detected_qty} ${parsedHint.detected_unit}`
                  : parsedHint.detected_qty != null
                    ? String(parsedHint.detected_qty)
                    : null,
                parsedHint.detected_packaging,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>

        {/* Category */}
        <div>
          <label style={labelStyle}>CATEGORIA</label>
          {!showCategoryPicker ? (
            <button
              type="button"
              onClick={() => setShowCategoryPicker(true)}
              style={{
                width: '100%', height: 44, borderRadius: 8, textAlign: 'left',
                padding: '0 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: category ? 'var(--surface-2)' : 'var(--bg)',
                border: category ? '1px solid var(--border-focus)' : '1px solid var(--border)',
                color: category ? 'var(--text)' : 'var(--text-subtle)',
                fontSize: 14, cursor: 'pointer',
              }}
            >
              <span>{category || 'Escolher categoria…'}</span>
              <span style={{ fontSize: 11, opacity: 0.5 }}>▾</span>
            </button>
          ) : (
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border-focus)', borderRadius: 8, padding: '10px 10px 6px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {ARTICLE_CATEGORIES.map(cat => {
                  const isSelected  = category === cat
                  const isSuggested = !category && suggestCategory({ name }).category === cat
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => { setCategory(cat); setShowCategoryPicker(false); setIsDirty(true) }}
                      style={{
                        padding: '6px 12px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                        fontWeight: isSelected || isSuggested ? 600 : 400,
                        border: isSelected ? '2px solid var(--action)' : isSuggested ? '1px solid var(--action)' : '1px solid var(--border)',
                        background: isSelected ? 'var(--action)' : isSuggested ? 'var(--action-glow)' : 'transparent',
                        color: isSelected ? 'var(--text-on-primary)' : 'var(--text)',
                      }}
                    >
                      {cat}
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Outra categoria…"
                  value={(ARTICLE_CATEGORIES as readonly string[]).includes(category) ? '' : category}
                  onChange={e => { setCategory(e.target.value); setIsDirty(true) }}
                  onKeyDown={e => { if (e.key === 'Enter' && category.trim()) setShowCategoryPicker(false) }}
                  style={{ ...inputStyle, flex: 1, height: 36, fontSize: 13 }}
                />
                {category && (
                  <button
                    type="button"
                    onClick={() => { setCategory(''); setShowCategoryPicker(false); setIsDirty(true) }}
                    style={{ height: 36, padding: '0 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-subtle)', fontSize: 12, cursor: 'pointer' }}
                  >
                    Limpar
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Unit */}
        <div>
          <label style={labelStyle}>UNIDADE BASE</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['g', 'mL', 'un'] as const).map(u => {
              const isSelected  = unit === u
              const suggested   = !unit.trim() ? normalizeArticleInput(name, aliases).unit : null
              const isSuggested = suggested === u
              return (
                <button
                  key={u}
                  type="button"
                  onClick={() => { setUnit(u); setIsDirty(true) }}
                  style={{
                    flex: 1, height: 44, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace',
                    border: isSelected ? '2px solid var(--action)' : isSuggested ? '2px solid var(--border-focus)' : '1px solid var(--border)',
                    background: isSelected ? 'var(--action)' : 'var(--bg)',
                    color: isSelected ? 'var(--text-on-primary)' : 'var(--text)',
                  }}
                >
                  {u}
                </button>
              )
            })}
          </div>
        </div>

        {/* Par Level */}
        <div>
          <label style={labelStyle}>
            STOCK MÍNIMO{unit.trim() ? ` (em ${unit.trim()})` : ''}
          </label>
          <input
            type="number"
            min="0"
            step="any"
            placeholder="0"
            value={parLevel}
            onChange={e => { setParLevel(e.target.value); setIsDirty(true) }}
            style={{ ...inputStyle, width: '40%' }}
          />
          <p style={{ fontSize: 10, color: 'var(--text-on-primary-subtle)', marginTop: 3 }}>
            Abaixo deste valor o sistema sugere encomenda
          </p>
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
                {/* Row 1: supplier + star + delete */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    value={link.supplier_id}
                    onChange={e => { updateLink(link.key, { supplier_id: e.target.value }); setIsDirty(true) }}
                    style={{ flex: 1, height: 44, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13, padding: '0 8px', outline: 'none', cursor: 'pointer' }}
                  >
                    <option value="">Selecionar fornecedor…</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button
                    onClick={() => setPreferred(link.key)}
                    title="Fornecedor preferido"
                    style={{
                      width: 44, height: 44, borderRadius: 6, flexShrink: 0,
                      border: link.is_preferred ? '1px solid var(--action)' : '1px solid var(--border)',
                      background: link.is_preferred ? 'var(--action)' : 'transparent',
                      color: link.is_preferred ? 'var(--text-on-primary)' : 'var(--text-subtle)',
                      fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >{link.is_preferred ? '★' : '☆'}</button>
                  <button
                    onClick={() => { removeLink(link.key); setIsDirty(true) }}
                    style={{ width: 44, height: 44, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-subtle)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >×</button>
                </div>

                {/* Row 2: price + order unit */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: 'var(--text-subtle)', display: 'block', marginBottom: 2 }}>PREÇO (€)</label>
                    <input
                      type="number" min="0" step="any" placeholder="0.00"
                      value={link.price}
                      onChange={e => { updateLink(link.key, { price: e.target.value }); setIsDirty(true) }}
                      style={cellInput}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 10, color: 'var(--text-subtle)', display: 'block', marginBottom: 2 }}>UN. COMPRA</label>
                    <input
                      list={`units-order-link-${link.key}`}
                      placeholder="ex: caixa, saco…"
                      value={link.order_unit}
                      onChange={e => { updateLink(link.key, { order_unit: e.target.value }); setIsDirty(true) }}
                      onBlur={e => updateLink(link.key, { order_unit: e.target.value.trim().toLowerCase() })}
                      style={cellInput}
                    />
                    <datalist id={`units-order-link-${link.key}`}>
                      {ORDER_UNITS.map(u => <option key={u} value={u} />)}
                    </datalist>
                  </div>
                </div>

                {/* Row 3: advanced toggle */}
                <button
                  type="button"
                  onClick={() => setExpandedLinks(prev => {
                    const next = new Set(prev)
                    if (next.has(link.key)) next.delete(link.key); else next.add(link.key)
                    return next
                  })}
                  style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-subtle)', fontSize: 11, cursor: 'pointer', textAlign: 'left', letterSpacing: '0.04em' }}
                >
                  {expandedLinks.has(link.key) ? '▾ Ocultar' : '› Qtd. por embalagem e referência'}
                </button>

                {/* Row 4: advanced fields */}
                {expandedLinks.has(link.key) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4, borderTop: '1px solid var(--border)' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: 'var(--text-subtle)', display: 'block', marginBottom: 2 }}>
                        {link.order_unit.trim()
                          ? `Quantas ${unit || 'unidades'} vêm por ${link.order_unit.trim()}?`
                          : 'QTD. POR EMBALAGEM'}
                      </label>
                      <input
                        type="number" min="0.01" step="any" placeholder="ex: 6"
                        value={link.conversion_factor}
                        onChange={e => { updateLink(link.key, { conversion_factor: e.target.value }); setIsDirty(true) }}
                        style={cellInput}
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Ref. fornecedor (opcional)"
                      value={link.supplier_ref}
                      onChange={e => { updateLink(link.key, { supplier_ref: e.target.value }); setIsDirty(true) }}
                      style={cellInput}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={() => { setLinks(prev => [...prev, emptyLink()]); setIsDirty(true) }}
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
          onClick={handleCancel}
          style={{ flex: 1, height: 48, borderRadius: 10, border: `1px solid var(--border-on-primary)`, background: 'transparent', color: 'var(--text-on-primary-muted)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
        >
          ← Voltar
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
