'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import type { CurrentStock } from '@/types/database'
import { fetchCurrentStock, fetchAllArticleSizes, saveStockCount } from '@/lib/supabase'
import type { ArticleSize } from '@/lib/supabase'
import ArticleCard from './ArticleCard'
import type { SizeRow } from './ArticleCard'

type DirtyMap   = Record<string, string>           // simple mode: articleId → qty string
type SizeRowMap = Record<string, SizeRow[]>        // multi-size mode: articleId → rows

export default function InventoryScreen() {
  const [articles,    setArticles]    = useState<CurrentStock[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [selectedId,  setSelectedId]  = useState<string | null>(null)
  const [dirty,       setDirty]       = useState<DirtyMap>({})
  const [sizeRowMap,  setSizeRowMap]  = useState<SizeRowMap>({})
  const [savingId,      setSavingId]      = useState<string | null>(null)
  const [countedThisSession, setCountedThisSession] = useState<Set<string>>(new Set())
  const [search,        setSearch]        = useState('')
  const [saveSuccess,   setSaveSuccess]   = useState<string | null>(null)
  const [saveNoChange,  setSaveNoChange]  = useState<string | null>(null)
  const [articleSizes, setArticleSizes] = useState<Map<string, ArticleSize[]>>(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [data, sizes] = await Promise.all([fetchCurrentStock(), fetchAllArticleSizes()])
      setArticles(data)
      setArticleSizes(sizes)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao carregar inventário')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() =>
    articles.filter(a =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.category ?? '').toLowerCase().includes(search.toLowerCase())
    ),
    [articles, search]
  )

  const sortedFiltered = useMemo(() => {
    const byName    = (a: CurrentStock, b: CurrentStock) => a.name.localeCompare(b.name, 'pt')
    const counted   = filtered.filter(a =>  countedThisSession.has(a.article_id))
    const uncounted = filtered.filter(a => !countedThisSession.has(a.article_id))
    const belowPar  = uncounted.filter(a => a.current_qty < a.par_level)
    const abovePar  = uncounted.filter(a => a.current_qty >= a.par_level)
    return [
      ...belowPar.sort(byName),
      ...abovePar.sort(byName),
      ...counted.sort(byName),
    ]
  }, [filtered, countedThisSession])

  /** Constrói SizeRow[] com label de display para um artigo */
  function buildSizeRows(_article: CurrentStock, rawSizes: ArticleSize[]): SizeRow[] {
    return rawSizes.map(s => ({
      size_label:    s.label,
      qty:           '0',
      base_per_unit: s.base_per_unit,
    }))
  }

  const handleSelect = (id: string) => {
    if (selectedId === id) {
      setSelectedId(null)
      return
    }
    setSelectedId(id)
    const art    = articles.find(a => a.article_id === id)
    const sizes  = articleSizes.get(id) ?? []

    if (sizes.length > 0) {
      // Modo multi-tamanho: inicializar rows se ainda não existem
      if (!sizeRowMap[id]) {
        setSizeRowMap(prev => ({ ...prev, [id]: buildSizeRows(art!, sizes) }))
      }
    }
  }

  const handleQtyChange = (id: string, val: string) => {
    setDirty(prev => ({ ...prev, [id]: val }))
  }

  const handleSizeRowChange = (id: string, idx: number, qty: string) => {
    setSizeRowMap(prev => {
      const rows = [...(prev[id] ?? [])]
      rows[idx] = { ...rows[idx], qty }
      return { ...prev, [id]: rows }
    })
  }

  const handleConfirm = async (id: string) => {
    const article = articles.find(a => a.article_id === id)
    if (!article) return

    const sizes   = articleSizes.get(id) ?? []
    const isMulti = sizes.length > 0

    setSavingId(id)
    try {
      let result: { saved: boolean }

      if (isMulti) {
        // Multi-tamanho: aceita zero (contagem explícita de zero é válida)
        const rows = sizeRowMap[id] ?? []
        const components = rows.map(r => ({
          size_label:    r.size_label,
          qty:           parseFloat(r.qty) || 0,
          base_per_unit: r.base_per_unit,
        }))
        const totalBase     = components.reduce((s, c) => s + c.qty * c.base_per_unit, 0)
        const totalStockQty = totalBase / (article.base_per_stock || 1)

        result = await saveStockCount(
          id, totalStockQty, article.stock_unit, components,
          undefined,
          article.current_qty_base, article.unit, article.base_per_stock,
        )

        if (result.saved) {
          setArticles(prev =>
            prev.map(a => a.article_id === id ? {
              ...a,
              current_qty_base: totalBase,
              current_qty:      totalStockQty,
              diff_from_par:    totalStockQty - a.par_level,
            } : a)
          )
          setSizeRowMap(prev => {
            const next = { ...prev }
            delete next[id]
            return next
          })
        }
      } else {
        // Modo simples: sem pré-preenchimento, valor vazio = sem contagem
        if (!dirty[id]) { setSavingId(null); return }
        const newQty = parseFloat(dirty[id])
        if (isNaN(newQty)) { setSavingId(null); return }

        result = await saveStockCount(
          id, newQty, article.stock_unit,
          undefined, undefined,
          article.current_qty_base, article.unit, article.base_per_stock,
        )

        if (result.saved) {
          setArticles(prev =>
            prev.map(a => a.article_id === id ? {
              ...a,
              current_qty:      newQty,
              current_qty_base: newQty * a.base_per_stock,
              diff_from_par:    newQty - a.par_level,
            } : a)
          )
          setDirty(prev => {
            const next = { ...prev }
            delete next[id]
            return next
          })
        }
      }

      if (result.saved) {
        setSaveSuccess(id)
        setCountedThisSession(prev => new Set([...prev, id]))
        setTimeout(() => setSaveSuccess(null), 1500)

        // Avançar para o próximo artigo (na ordem operacional actual)
        const idx  = sortedFiltered.findIndex(a => a.article_id === id)
        const next = sortedFiltered[idx + 1]
        if (next && !countedThisSession.has(next.article_id)) {
          setSelectedId(next.article_id)
          const nextSizes = articleSizes.get(next.article_id) ?? []
          if (nextSizes.length > 0) {
            const nextArt = articles.find(a => a.article_id === next.article_id)
            if (!sizeRowMap[next.article_id]) {
              setSizeRowMap(prev => ({ ...prev, [next.article_id]: buildSizeRows(nextArt!, nextSizes) }))
            }
          }
        } else {
          setSelectedId(null)
        }
      } else {
        setSaveNoChange(id)
        setTimeout(() => setSaveNoChange(null), 1500)
      }
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao guardar')
    } finally {
      setSavingId(null)
    }
  }

  const dirtyCount =
    Object.keys(dirty).length +
    Object.values(sizeRowMap).filter(rows => rows.some(r => (parseFloat(r.qty) || 0) > 0)).length

  const belowPar = articles.filter(a => a.current_qty < a.par_level).length

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            border: '3px solid var(--border)',
            borderTopColor: 'var(--action)',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 16px',
          }} />
          <p style={{ color: 'var(--text-subtle)', fontSize: 14 }}>A carregar inventário…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>

      {/* Header */}
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Contagem de Stock</h2>
            <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
              {articles.length} artigos
              {belowPar > 0 && <span style={{ color: 'var(--error)', marginLeft: 8 }}>· {belowPar} abaixo do par</span>}
            </p>
          </div>
          {dirtyCount > 0 && (
            <span style={{
              background:    'var(--warning-surface)',
              border:        `1px solid var(--warning-border)`,
              color:         'var(--warning-text)',
              fontSize:      11,
              fontWeight:    600,
              padding:       '3px 8px',
              borderRadius:  6,
              letterSpacing: '0.05em',
            }}>
              {dirtyCount} PENDENTE{dirtyCount !== 1 ? 'S' : ''}
            </span>
          )}
        </div>
        <input
          type="text"
          placeholder="Pesquisar artigo…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width:      '100%',
            height:     40,
            background: 'var(--surface)',
            border:     '1px solid var(--border)',
            borderRadius: 8,
            padding:    '0 12px',
            color:      'var(--text)',
            fontSize:   14,
            outline:    'none',
          }}
        />
      </div>

      {/* List */}
      <div style={{
        flex:          1,
        overflowY:     'auto',
        padding:       '12px 16px',
        display:       'flex',
        flexDirection: 'column',
        gap:           8,
        maxWidth:      680,
        width:         '100%',
        alignSelf:     'center',
        boxSizing:     'border-box',
      }}>
        {error && (
          <div style={{ background: 'var(--error-surface)', border: '1px solid var(--error-border)', borderRadius: 8, padding: '10px 14px', color: 'var(--error)', fontSize: 13 }}>
            {error}
          </div>
        )}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-subtle)', paddingTop: 40, fontSize: 14 }}>
            Nenhum artigo encontrado
          </div>
        )}
        {sortedFiltered.map(article => {
          const id     = article.article_id
          const sizes  = articleSizes.get(id) ?? []
          const isMulti = sizes.length > 0
          const rows   = sizeRowMap[id]
          const isDirty = isMulti
            ? (rows?.some(r => (parseFloat(r.qty) || 0) > 0) ?? false)
            : !!dirty[id]

          return (
            <div key={id}>
              {saveSuccess === id && (
                <div style={{
                  background:   'var(--success-surface)',
                  border:       '1px solid var(--success-border)',
                  borderRadius: 8,
                  padding:      '8px 14px',
                  color:        'var(--success)',
                  fontSize:     13,
                  fontWeight:   600,
                  textAlign:    'center',
                  marginBottom: 4,
                }}>
                  ✓ Contagem guardada
                </div>
              )}
              {saveNoChange === id && (
                <div style={{
                  background:   'var(--surface)',
                  border:       '1px solid var(--border)',
                  borderRadius: 8,
                  padding:      '8px 14px',
                  color:        'var(--text-subtle)',
                  fontSize:     13,
                  fontWeight:   500,
                  textAlign:    'center',
                  marginBottom: 4,
                }}>
                  Sem alteração — valor igual ao atual
                </div>
              )}
              <ArticleCard
                article={article}
                isSelected={selectedId === id}
                isExpanded={selectedId === id}
                isDirty={isDirty}
                isCounted={countedThisSession.has(id)}
                isSaving={savingId === id}
                onClick={() => handleSelect(id)}
                onConfirm={() => handleConfirm(id)}
                // Modo simples
                newQty={dirty[id]}
                onQtyChange={val => handleQtyChange(id, val)}
                // Modo multi-tamanho
                sizeRows={isMulti && selectedId === id ? rows : undefined}
                onSizeRowChange={(idx, qty) => handleSizeRowChange(id, idx, qty)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
