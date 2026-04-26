'use client'

import { useState, useEffect, useRef } from 'react'
import type { Article, Supplier } from '@/types/database'
import {
  createArticle, updateArticle, toggleArticleActive,
  fetchAllSuppliers, fetchArticleSuppliers, saveArticleSuppliers,
  createArticleSizeIfMissing,
} from '@/lib/supabase'
import { ORDER_UNITS, formatUnit, formatStockQty } from '@/lib/units'
import { ARTICLE_CATEGORIES } from '@/lib/categoryKeywords'
import { maybeLearnAlias, normalizeKey } from '@/lib/ingredientDictionary'
import { normalizeArticleInput } from '@/lib/normalizeArticle'
import { buildArticleDraft, formatDraftHint, type ArticleDraft } from '@/lib/articleDraft'
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


// Sugestões de g_per_unit para artigos contáveis comuns (chaves em normalizeKey format)
const G_PER_UNIT_HINTS: Record<string, number> = {
  'ovo': 52, 'ovos': 52, 'ovos frescos': 52,
  'clara': 30, 'claras': 30,
  'gema': 18, 'gemas': 18,
  'ovo de codorniz': 10, 'ovos de codorniz': 10,
  'limao': 90, 'limao amarelo': 90,
  'lima': 60,
  'laranja': 130,
  'banana': 120,
  'kiwi': 80,
  'maca': 150,
  'pera': 160,
  'pessego': 150,
  'nectarina': 140,
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
  fontSize:      10,
  fontWeight:    700,
  color:         'var(--text-muted)',
  letterSpacing: '0.1em',
  marginBottom:  8,
  display:       'block',
  textTransform: 'uppercase',
}

// Header de secção (STOCK, FORNECEDORES). Maior peso que labelStyle para
// criar hierarquia clara entre "secção" e "campo dentro da secção".
const sectionHeaderStyle: React.CSSProperties = {
  fontSize:      11,
  fontWeight:    800,
  color:         'var(--text)',
  letterSpacing: '0.12em',
  marginBottom:  12,
  marginTop:     8,
  textTransform: 'uppercase',
  paddingBottom: 6,
  borderBottom:  '1px solid var(--border)',
}

const inputStyle: React.CSSProperties = {
  width:        '100%',
  height:       44,
  background:   'var(--surface)',
  border:       '1px solid var(--border)',
  borderRadius: 8,
  padding:      '0 14px',
  color:        'var(--text)',
  fontSize:     15,
  outline:      'none',
  fontFamily:   'inherit',
}

const cellInput: React.CSSProperties = {
  width:        '100%',
  height:       44,
  background:   'var(--surface)',
  border:       '1px solid var(--border)',
  borderRadius: 6,
  padding:      '0 10px',
  color:        'var(--text)',
  fontSize:     14,
  outline:      'none',
  fontFamily:   'inherit',
}

export default function ArticleForm({ existing, articles, onSaved, onCancel }: Props) {
  const isEdit = !!existing

  const [name,               setName]              = useState(existing?.name     ?? '')
  const [category,           setCategory]          = useState(existing?.category ?? '')
  const [unit,               setUnit]              = useState<'g' | 'mL' | 'un'>((existing?.unit as 'g' | 'mL' | 'un') ?? 'g')
  const [parLevel,           setParLevel]          = useState(existing ? String(existing.par_level) : '')
  const [parLevelDisplay,    setParLevelDisplay]   = useState('')
  const [gPerUnit,           setGPerUnit]          = useState(existing?.g_per_unit != null ? String(existing.g_per_unit) : '')
  const [links,              setLinks]             = useState<LinkRow[]>([])
  const [suppliers,          setSuppliers]         = useState<Supplier[]>([])
  const [expandedLinks,      setExpandedLinks]     = useState<Set<string>>(new Set())
  const [saving,             setSaving]            = useState(false)
  const [error,              setError]             = useState<string | null>(null)
  const [isDirty,            setIsDirty]           = useState(false)
  const [duplicateWarning,   setDuplicateWarning]  = useState<string | null>(null)
  const [parsedHint,         setParsedHint]         = useState<ArticleDraft | null>(null)
  const [autoFillMsg,        setAutoFillMsg]        = useState<{ key: string; text: string } | null>(null)
  // Campos preenchidos automaticamente (parser ou heurística). Limpos quando user edita.
  // Keys: 'gPerUnit' | `orderUnit_${linkKey}` | `conv_${linkKey}`
  const [autoFilled,         setAutoFilled]         = useState<Set<string>>(new Set())

  const { aliases, learnAlias } = useOrgAliases()
  const rawNameRef              = useRef(existing?.name ?? '')
  const nameChangedAfterBlurRef = useRef(false)
  const parsedSeedRef           = useRef<ArticleDraft | null>(null)
  const autoFillTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unitManuallySet         = useRef(!!existing)

  // ── Stock Mínimo: fonte de unidade (preferred → qualquer link → seed → base) ──
  // Usada para mostrar/inputar par level na unidade que o chef pensa (caixa, frasco)
  // mantendo par_level guardado em base_unit.
  const parPreferredLink = links.find(l =>
    l.is_preferred && l.order_unit.trim() && parseFloat(l.conversion_factor) > 0
  )
  const parFallbackLink = !parPreferredLink
    ? links.find(l => l.order_unit.trim() && parseFloat(l.conversion_factor) > 0)
    : undefined
  const parSeed = (!parPreferredLink && !parFallbackLink)
    ? parsedHint?.supplierSeed
    : undefined
  const parSeedHasFactor = !!parSeed?.order_unit && parSeed.conversion_factor != null
  const parMinUnit = parPreferredLink?.order_unit
    ?? parFallbackLink?.order_unit
    ?? (parSeedHasFactor ? parSeed!.order_unit : null)
  const parMinFactor = parPreferredLink
    ? parseFloat(parPreferredLink.conversion_factor)
    : parFallbackLink
    ? parseFloat(parFallbackLink.conversion_factor)
    : parSeedHasFactor
    ? parSeed!.conversion_factor!
    : 1
  const parUseOrderUnit = !!parMinUnit && parMinFactor > 0

  // Esconder bloco "Mede em" quando o parser detetou unidade base explícita
  // (weight/volume/unit com qty). Em edição mantém visível porque o artigo
  // já está guardado e o chef pode querer ajustar.
  const hideUnitBlock = !isEdit && parsedHint?.detected_qty != null

  const markAuto = (field: string) => setAutoFilled(prev => {
    if (prev.has(field)) return prev
    return new Set([...prev, field])
  })
  const unmarkAuto = (field: string) => setAutoFilled(prev => {
    if (!prev.has(field)) return prev
    const next = new Set(prev)
    next.delete(field)
    return next
  })

  // Formata um conversion_factor (sempre em base unit) para display.
  // Comparações e cálculos usam sempre o valor bruto em número.
  const fmtFactor = (raw: string) => {
    const n = parseFloat(raw)
    if (!n) return raw
    return formatUnit(n, unit)
  }

  const handleNameBlur = () => {
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
      if (!unitManuallySet.current) setUnit(normalized.unit)
    }

    // Deteção de duplicados (só para artigos novos)
    if (!isEdit && articles) {
      const key = normalized.normalizedKey
      const dup = articles.find(a => normalizeKey(a.name) === key)
      setDuplicateWarning(dup ? `Artigo semelhante já existe: "${dup.name}"` : null)
    }

    // Auto-sugestão de g_per_unit para artigos contáveis
    const effectiveUnit = unitManuallySet.current ? unit : normalized.unit
    if (effectiveUnit === 'un' && !gPerUnit) {
      const hint = G_PER_UNIT_HINTS[normalized.normalizedKey]
      if (hint) {
        setGPerUnit(String(hint))
        markAuto('gPerUnit')
      }
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

  // Sincronizar display do Stock Mínimo quando a fonte de unidade muda
  // (e.g., adiciona/remove fornecedor, muda preferred ou conversion_factor).
  // Não inclui parLevel nas deps — durante digitação, o display é controlado
  // pelo onChange e re-derivar partiria valores intermédios como "1.".
  useEffect(() => {
    const base = parseFloat(parLevel) || 0
    if (base <= 0) {
      setParLevelDisplay('')
      return
    }
    setParLevelDisplay(
      parUseOrderUnit
        ? String(+(base / parMinFactor).toFixed(2))
        : parLevel
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parUseOrderUnit, parMinFactor])

  const updateLink = (key: string, partial: Partial<LinkRow>) =>
    setLinks(prev => prev.map(l => l.key === key ? { ...l, ...partial } : l))

  const setPreferred = (key: string) =>
    setLinks(prev => prev.map(l => ({ ...l, is_preferred: l.key === key })))

  const removeLink = (key: string) =>
    setLinks(prev => prev.filter(l => l.key !== key))

  const handleSave = async () => {
    if (!name.trim()) return setError('Nome é obrigatório')
    const par = parseFloat(parLevel)
    if (isNaN(par) || par < 0) return setError('Stock mínimo inválido')

    const validLinks = links.filter(l =>
      l.supplier_id && parseFloat(l.price) > 0 && l.order_unit.trim()
    )

    setSaving(true)
    setError(null)
    try {
      const normalized = normalizeArticleInput(name.trim(), aliases)
      const gPer = parseFloat(gPerUnit)
      const input = {
        name:       normalized.name,
        unit:       unit.trim(),
        par_level:  par,
        category:   category.trim() || undefined,
        g_per_unit: unit === 'un' && !isNaN(gPer) && gPer > 0 ? gPer : null,
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

      // Criação manual: se o parser detetou supplierSeed e não foi guardado
      // nenhum fornecedor real, persistir a embalagem como article_size para
      // o inventário ter unidade operacional. Idempotente; falha não bloqueia.
      const seed = parsedSeedRef.current?.supplierSeed
      if (
        !isEdit &&
        validLinks.length === 0 &&
        seed?.order_unit &&
        seed.conversion_factor != null &&
        seed.conversion_factor > 0 &&
        seed.order_unit !== input.unit
      ) {
        try {
          await createArticleSizeIfMissing(saved.id, seed.order_unit, seed.conversion_factor)
        } catch (e) {
          console.error('createArticleSize falhou:', { articleId: saved.id, label: seed.order_unit, error: e })
        }
      }

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
      {/* Header — chevron de voltar + eyebrow + título. Tom contínuo com
          o resto da app (cream); antes era dark e isolava o painel. */}
      <div style={{
        flexShrink:    0,
        padding:       '20px 24px 16px',
        borderBottom:  '1px solid var(--border)',
        display:       'flex',
        alignItems:    'center',
        gap:           14,
      }}>
        <button
          type="button"
          onClick={handleCancel}
          aria-label="Voltar"
          style={{
            width:          'var(--touch-min)',
            height:         'var(--touch-min)',
            borderRadius:   10,
            border:         '1px solid var(--border)',
            background:     'var(--surface)',
            color:          'var(--text-muted)',
            fontSize:       20,
            cursor:         'pointer',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            flexShrink:     0,
            touchAction:    'manipulation',
            transition:     'border-color 0.15s, color 0.15s',
          }}
        >
          ←
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{
            fontSize:      10,
            color:         'var(--text-subtle)',
            letterSpacing: '0.14em',
            fontWeight:    700,
            margin:        0,
            marginBottom:  3,
            textTransform: 'uppercase',
          }}>
            {isEdit ? 'Editar artigo' : 'Novo artigo'}
          </p>
          <h3 style={{
            fontFamily:    "'Playfair Display', serif",
            fontSize:      24,
            fontWeight:    600,
            color:         'var(--text)',
            margin:        0,
            whiteSpace:    'nowrap',
            overflow:      'hidden',
            textOverflow:  'ellipsis',
            letterSpacing: '-0.015em',
            lineHeight:    1.15,
          }}>
            {isEdit ? existing.name : 'Novo Artigo'}
          </h3>
        </div>
      </div>

      {/* Body — gap mais generoso e padding lateral 24px para respirar */}
      <div style={{
        flex:          1,
        overflowY:     'auto',
        display:       'flex',
        flexDirection: 'column',
        gap:           20,
        padding:       '20px 24px 8px',
      }}>

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
              // Inferência de unidade base em tempo real
              if (!isEdit && !unitManuallySet.current) {
                setUnit(normalizeArticleInput(val, aliases).unit)
              }
              // Hint de parsing em tempo real + seed para auto-fill do fornecedor
              const draft = buildArticleDraft(val, aliases)
              const hasExtracted =
                draft.detected_qty != null ||
                draft.detected_label != null ||
                draft.supplierSeed != null
              setParsedHint(hasExtracted ? draft : null)
              parsedSeedRef.current = hasExtracted ? draft : null
            }}
            onBlur={handleNameBlur}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) handleSave() }}
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
              {formatDraftHint(parsedHint)}
            </p>
          )}
        </div>

        {/* Categoria — chips em scroll horizontal (mesmo pattern dos
            filtros da lista: familiar, compacto, mobile-first). Custom
            categoria é um toggle discreto que só aparece quando preciso —
            no caso normal, o parser já preencheu uma categoria standard
            e o chef apenas confirma com um tap. */}
        <CategoryField
          value={category}
          onChange={(v) => { setCategory(v); setIsDirty(true) }}
        />

        {/* Unidade — segmented sempre visível. hideUnitBlock continua a
            esconder em criação se o parser já detetou peso/volume explícito,
            evitando perguntar o que já é certo. */}
        {!hideUnitBlock && (
          <div>
            <label style={labelStyle}>UNIDADE</label>
            <div style={{
              display:      'flex',
              border:       '1px solid var(--border)',
              borderRadius: 8,
              overflow:     'hidden',
              background:   'var(--bg)',
              width:        'fit-content',
            }}>
              {(['g', 'mL', 'un'] as const).map((u, i) => {
                const isSelected = unit === u
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => {
                      setUnit(u)
                      unitManuallySet.current = true
                      setIsDirty(true)
                      if (u === 'un' && !gPerUnit && name.trim()) {
                        const hint = G_PER_UNIT_HINTS[normalizeKey(name)]
                        if (hint) {
                          setGPerUnit(String(hint))
                          markAuto('gPerUnit')
                        }
                      }
                    }}
                    style={{
                      minWidth:    64,
                      height:      44,
                      padding:     '0 18px',
                      border:      'none',
                      borderLeft:  i > 0 ? '1px solid var(--border)' : 'none',
                      background:  isSelected ? 'var(--action)' : 'transparent',
                      color:       isSelected ? 'var(--text-on-primary)' : 'var(--text)',
                      fontFamily:  'JetBrains Mono, monospace',
                      fontSize:    14,
                      fontWeight:  isSelected ? 700 : 500,
                      cursor:      'pointer',
                      transition:  'background 0.15s, color 0.15s',
                    }}
                  >
                    {u}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* STOCK — agrupa parâmetros operacionais. Stock mínimo dispara
            sugestão de encomenda; Peso por unidade só aparece quando o
            artigo se conta à unidade (un) e é necessário para fichas
            técnicas em gramas. */}
        <div>
          <h4 style={sectionHeaderStyle}>STOCK</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Stock mínimo — input na unidade do chef (caixa, frasco,
                garrafão); par_level continua guardado em base_unit. Fonte
                de unidade: link preferred → qualquer link válido → seed
                do parser → base_unit. */}
            <div>
              <label style={labelStyle}>
                STOCK MÍNIMO (em {parMinUnit ?? unit})
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={parLevelDisplay}
                  onChange={e => {
                    const v = e.target.value
                    setParLevelDisplay(v)
                    const num = parseFloat(v)
                    if (v === '' || isNaN(num) || num < 0) {
                      setParLevel('')
                    } else {
                      setParLevel(String(parUseOrderUnit ? num * parMinFactor : num))
                    }
                    setIsDirty(true)
                  }}
                  style={{ ...inputStyle, width: '40%' }}
                />
                {parUseOrderUnit && (parseFloat(parLevel) || 0) > 0 && (
                  <span style={{
                    fontSize:   12,
                    color:      'var(--text-subtle)',
                    fontFamily: 'JetBrains Mono, monospace',
                    flexShrink: 0,
                  }}>
                    ≈ {formatStockQty(parseFloat(parLevel), unit)}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 3 }}>
                Quando o stock baixar deste valor, o Zesto sugere encomenda.
              </p>
            </div>

            {/* Peso por unidade — só para unit==='un'. Necessário para
                fichas técnicas em gramas (ex.: 150g de ovos). */}
            {unit === 'un' && (() => {
              const gNum       = parseFloat(gPerUnit)
              const hasValue   = !isNaN(gNum) && gNum > 0
              const outOfRange = hasValue && (gNum < 5 || gNum > 2000)
              return (
                <div>
                  <label style={labelStyle}>PESO POR UNIDADE (g)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      placeholder="ex: 52"
                      value={gPerUnit}
                      onChange={e => { setGPerUnit(e.target.value); unmarkAuto('gPerUnit'); setIsDirty(true) }}
                      style={{ ...inputStyle, width: '40%' }}
                    />
                    {hasValue && (
                      <span style={{
                        fontSize:    12,
                        color:       outOfRange ? 'var(--warning)' : 'var(--text-subtle)',
                        fontFamily:  'JetBrains Mono, monospace',
                        flexShrink:  0,
                      }}>
                        1 un ≈ {gNum} g
                      </span>
                    )}
                  </div>
                  {outOfRange && (
                    <p style={{ fontSize: 11, color: 'var(--warning)', marginTop: 6, marginBottom: 0 }}>
                      Valor fora do esperado (5–2000g) — confirma se correto.
                    </p>
                  )}
                  {!gPerUnit && (
                    <p style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 3, marginBottom: 0 }}>
                      Necessário para usar gramas nas fichas técnicas (ex: 150g ovos).
                    </p>
                  )}
                </div>
              )
            })()}
          </div>
        </div>

        {/* Supplier links */}
        <div>
          <h4 style={sectionHeaderStyle}>FORNECEDORES</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {links.map(link => {
              // Aviso de inconsistência: mesmo order_unit, conversion_factor diferente
              const currentFactor = parseFloat(link.conversion_factor)
              const refLink = link.order_unit.trim()
                ? links.find(l =>
                    l.key !== link.key &&
                    l.order_unit.trim() === link.order_unit.trim() &&
                    parseFloat(l.conversion_factor) > 0
                  )
                : undefined
              const conversionMismatch =
                refLink &&
                currentFactor > 0 &&
                parseFloat(refLink.conversion_factor) !== currentFactor
                  ? `Este artigo já usa 1 ${refLink.order_unit} = ${fmtFactor(refLink.conversion_factor)} noutro fornecedor`
                  : null

              return (
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
                    <label style={{
                      fontSize: 10, color: 'var(--text-subtle)',
                      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2,
                    }}>
                      <span>UN. COMPRA</span>
                      {autoFilled.has(`orderUnit_${link.key}`) && (
                        <span style={{
                          fontFamily:    'JetBrains Mono, monospace',
                          letterSpacing: '0.05em',
                          color:         'var(--text-subtle)',
                          fontWeight:    400,
                        }}>·auto</span>
                      )}
                    </label>
                    <input
                      list={`units-order-link-${link.key}`}
                      placeholder="ex: caixa, saco…"
                      value={link.order_unit}
                      onChange={e => {
                        updateLink(link.key, { order_unit: e.target.value })
                        unmarkAuto(`orderUnit_${link.key}`)
                        setIsDirty(true)
                        if (autoFillMsg?.key === link.key) setAutoFillMsg(null)
                      }}
                      onBlur={e => updateLink(link.key, { order_unit: e.target.value.trim().toLowerCase() })}
                      style={cellInput}
                    />
                    <datalist id={`units-order-link-${link.key}`}>
                      {ORDER_UNITS.map(u => <option key={u} value={u} />)}
                    </datalist>
                  </div>
                </div>

                {/* Auto-fill feedback */}
                {autoFillMsg?.key === link.key && (
                  <p style={{
                    fontSize:    10,
                    color:       'var(--text-subtle)',
                    fontFamily:  'JetBrains Mono, monospace',
                    letterSpacing: '0.04em',
                    margin:      0,
                  }}>
                    {autoFillMsg.text}
                  </p>
                )}

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
                      <label style={{
                        fontSize: 10, color: 'var(--text-subtle)',
                        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2,
                      }}>
                        <span>{link.order_unit.trim()
                          ? `Quantas ${unit || 'unidades'} vêm por ${link.order_unit.trim()}?`
                          : 'QTD. POR EMBALAGEM'}</span>
                        {autoFilled.has(`conv_${link.key}`) && (
                          <span style={{
                            fontFamily:    'JetBrains Mono, monospace',
                            letterSpacing: '0.05em',
                            color:         'var(--text-subtle)',
                            fontWeight:    400,
                          }}>·auto</span>
                        )}
                      </label>
                      <input
                        type="number" min="0.01" step="any" placeholder="ex: 6"
                        value={link.conversion_factor}
                        onChange={e => {
                          updateLink(link.key, { conversion_factor: e.target.value })
                          unmarkAuto(`conv_${link.key}`)
                          setIsDirty(true)
                          if (autoFillMsg?.key === link.key) setAutoFillMsg(null)
                        }}
                        style={cellInput}
                      />
                    </div>
                    {conversionMismatch && (
                      <p style={{
                        fontSize:   10,
                        color:      'var(--warning)',
                        fontFamily: 'JetBrains Mono, monospace',
                        margin:     0,
                      }}>
                        {conversionMismatch}
                      </p>
                    )}
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
              )
            })}
          </div>

          <button
            onClick={() => {
              const seed       = parsedSeedRef.current?.supplierSeed
              const link       = emptyLink()
              let autoExpand   = false
              let msg          = ''

              const autoFields: string[] = []
              if (seed) {
                if (seed.order_unit) {
                  link.order_unit = seed.order_unit
                  autoFields.push(`orderUnit_${link.key}`)
                }
                if (seed.conversion_factor != null) {
                  link.conversion_factor = String(seed.conversion_factor)
                  autoExpand = true
                  autoFields.push(`conv_${link.key}`)
                }

                const hasConversion = link.conversion_factor !== '1'
                const hasPackaging  = !!link.order_unit
                if (hasPackaging && hasConversion) {
                  msg = `Auto: 1 ${link.order_unit} = ${fmtFactor(link.conversion_factor)}`
                } else if (hasPackaging) {
                  msg = `Auto: unidade de compra = ${link.order_unit}`
                } else if (hasConversion) {
                  msg = `Auto: ${fmtFactor(link.conversion_factor)}`
                }
              }

              setLinks(prev => [...prev, link])
              if (autoExpand) setExpandedLinks(prev => new Set([...prev, link.key]))
              if (autoFields.length > 0) {
                setAutoFilled(prev => new Set([...prev, ...autoFields]))
              }
              if (msg) {
                setAutoFillMsg({ key: link.key, text: msg })
                if (autoFillTimerRef.current) clearTimeout(autoFillTimerRef.current)
                autoFillTimerRef.current = setTimeout(() => setAutoFillMsg(null), 2000)
              }
              setIsDirty(true)
            }}
            style={{
              width:        '100%',
              height:       44,
              marginTop:    10,
              borderRadius: 8,
              border:       '1px dashed var(--border)',
              background:   'var(--surface)',
              color:        'var(--text-muted)',
              fontSize:     13,
              fontWeight:   500,
              cursor:       'pointer',
            }}
          >
            + Adicionar Fornecedor
          </button>
        </div>

        {/* Desativar — render directo, sem header "Zona de risco" formal:
            é uma única acção destrutiva. Promovemos a secção quando houver
            mais (eliminar, exportar, etc.). */}
        {isEdit && (
          <div style={{ paddingTop: 16, borderTop: `1px solid var(--border)` }}>
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
          <div style={{ background: 'var(--error-surface)', border: `1px solid var(--error-border)`, borderRadius: 8, padding: '10px 14px', color: 'var(--error)', fontSize: 13 }}>
            {error}
          </div>
        )}
      </div>

      {/* Footer — só Guardar. O voltar/cancelar já está claro no header
          (chevron ←); duplicar no rodapé era ruído. */}
      <div style={{
        padding:    '12px 24px 20px',
        borderTop:  '1px solid var(--border)',
        background: 'var(--bg)',
        flexShrink: 0,
      }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width:         '100%',
            height:        52,
            borderRadius:  10,
            border:        'none',
            background:    'var(--action)',
            color:         'var(--text-on-primary)',
            fontSize:      15,
            fontWeight:    600,
            letterSpacing: '0.01em',
            cursor:        saving ? 'default' : 'pointer',
            opacity:       saving ? 0.7 : 1,
            transition:    'background 0.15s, opacity 0.15s',
            boxShadow:     saving ? 'none' : '0 1px 0 rgba(168, 88, 34, 0.5)',
          }}
        >
          {saving ? 'A guardar…' : isEdit ? 'Guardar Alterações' : 'Guardar Artigo'}
        </button>
      </div>
    </div>
  )
}

// ── CategoryField ────────────────────────────────────────────────────────────
// Chips em scroll horizontal + chip "+ outra" que reveala input para
// categoria custom. Mantém pattern visual consistente com o filtro da
// lista de Artigos e Inventário (chips redondos, scroll horizontal).

function CategoryField({
  value,
  onChange,
}: {
  value:    string
  onChange: (next: string) => void
}) {
  const isStandard = (ARTICLE_CATEGORIES as readonly string[]).includes(value)
  const [showCustom, setShowCustom] = useState(!!value && !isStandard)

  return (
    <div>
      <label style={labelStyle}>CATEGORIA</label>
      <div
        role="tablist"
        aria-label="Escolher categoria"
        style={{
          display:                 'flex',
          gap:                     6,
          overflowX:               'auto',
          overflowY:               'hidden',
          margin:                  '0 -20px',
          padding:                 '0 20px 4px',
          scrollbarWidth:          'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {ARTICLE_CATEGORIES.map(cat => {
          const isSelected = value === cat
          return (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => { onChange(cat); setShowCustom(false) }}
              style={{
                flexShrink:   0,
                minHeight:    'var(--touch-min)',
                padding:      '0 14px',
                borderRadius: 22,
                border:       `1px solid ${isSelected ? 'var(--action)' : 'var(--border)'}`,
                background:   isSelected ? 'var(--action)' : 'var(--surface)',
                color:        isSelected ? 'var(--text-on-primary)' : 'var(--text-muted)',
                fontSize:     13,
                fontWeight:   isSelected ? 600 : 500,
                whiteSpace:   'nowrap',
                cursor:       'pointer',
                touchAction:  'manipulation',
              }}
            >
              {cat}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => { setShowCustom(true); if (isStandard) onChange('') }}
          style={{
            flexShrink:   0,
            minHeight:    'var(--touch-min)',
            padding:      '0 14px',
            borderRadius: 22,
            border:       `1px dashed var(--border)`,
            background:   showCustom && !isStandard ? 'var(--action-surface)' : 'transparent',
            color:        showCustom && !isStandard ? 'var(--action)' : 'var(--text-subtle)',
            fontSize:     13,
            fontWeight:   500,
            whiteSpace:   'nowrap',
            cursor:       'pointer',
            touchAction:  'manipulation',
          }}
        >
          + outra
        </button>
      </div>
      {showCustom && (
        <input
          type="text"
          placeholder="Categoria personalizada…"
          value={isStandard ? '' : value}
          onChange={e => onChange(e.target.value)}
          autoFocus
          style={{
            marginTop:    8,
            width:        '100%',
            height:       40,
            background:   'var(--surface)',
            border:       '1px solid var(--border)',
            borderRadius: 8,
            padding:      '0 12px',
            color:        'var(--text)',
            fontSize:     14,
            outline:      'none',
          }}
        />
      )}
    </div>
  )
}
