'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import type { CurrentStock } from '@/types/database'
import { fetchCurrentStock, saveStockCount } from '@/lib/supabase'
import ArticleCard from './ArticleCard'
import NumericKeypad from '@/components/ui/NumericKeypad'

type DirtyMap = Record<string, string> // articleId → typed value

export default function InventoryScreen() {
  const [articles, setArticles]       = useState<CurrentStock[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [selectedId, setSelectedId]   = useState<string | null>(null)
  const [dirty, setDirty]             = useState<DirtyMap>({})
  const [saving, setSaving]           = useState(false)
  const [search, setSearch]           = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  // ── Load data ──────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchCurrentStock()
      setArticles(data)
      if (data.length > 0 && !selectedId) setSelectedId(data[0].article_id)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao carregar inventário')
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ────────────────────────────────────────────────
  const filtered = useMemo(() =>
    articles.filter(a =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.category ?? '').toLowerCase().includes(search.toLowerCase())
    ),
    [articles, search]
  )

  const selected = articles.find(a => a.article_id === selectedId) ?? null
  const currentValue = selectedId
    ? dirty[selectedId] ?? String(selected?.current_qty ?? '0')
    : '0'

  // ── Handlers ───────────────────────────────────────────────
  const handleSelect = (id: string) => {
    setSelectedId(id)
    const art = articles.find(a => a.article_id === id)
    if (art && !dirty[id]) {
      setDirty(prev => ({ ...prev, [id]: String(art.current_qty) }))
    }
  }

  const handleKeypadChange = (val: string) => {
    if (!selectedId) return
    setDirty(prev => ({ ...prev, [selectedId]: val }))
  }

  const handleConfirm = async () => {
    if (!selected || !selectedId) return
    const newQty = parseFloat(dirty[selectedId] ?? '0')
    if (isNaN(newQty)) return

    setSaving(true)
    try {
      await saveStockCount(selectedId, newQty, selected.unit)
      // Optimistic update
      setArticles(prev =>
        prev.map(a =>
          a.article_id === selectedId
            ? { ...a, current_qty: newQty, diff_from_par: newQty - a.par_level }
            : a
        )
      )
      setDirty(prev => {
        const next = { ...prev }
        delete next[selectedId]
        return next
      })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)

      // Auto-advance to next
      const idx = filtered.findIndex(a => a.article_id === selectedId)
      const next = filtered[idx + 1]
      if (next) setSelectedId(next.article_id)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao guardar')
    } finally {
      setSaving(false)
    }
  }

  const dirtyCount  = Object.keys(dirty).length
  const belowPar    = articles.filter(a => a.current_qty < a.par_level).length

  // ── Render ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            border: '3px solid #2A2A2A',
            borderTopColor: '#FF5F1F',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 16px',
          }} />
          <p style={{ color: '#555555', fontSize: 14 }}>A carregar inventário…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return (
    <div style={{
      display:   'grid',
      gridTemplateColumns: 'minmax(0, 1fr) 340px',
      gap:       0,
      height:    'calc(100vh - 64px)',
      overflow:  'hidden',
    }}>

      {/* ── Left panel: article list ──────────────────────────── */}
      <div style={{
        display:        'flex',
        flexDirection:  'column',
        borderRight:    '1px solid #1C1C1C',
        overflow:       'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid #1C1C1C' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#F5F5F5' }}>Contagem de Stock</h2>
              <p style={{ fontSize: 12, color: '#555555', marginTop: 2 }}>
                {articles.length} artigos
                {belowPar > 0 && (
                  <span style={{ color: '#EF4444', marginLeft: 8 }}>
                    · {belowPar} abaixo do par
                  </span>
                )}
              </p>
            </div>
            {dirtyCount > 0 && (
              <span style={{
                background: 'rgba(245, 158, 11, 0.15)',
                border:     '1px solid #F59E0B',
                color:      '#F59E0B',
                fontSize:   11,
                fontWeight: 600,
                padding:    '3px 8px',
                borderRadius: 6,
                letterSpacing: '0.05em',
              }}>
                {dirtyCount} PENDENTE{dirtyCount !== 1 ? 'S' : ''}
              </span>
            )}
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Pesquisar artigo…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width:          '100%',
              height:         40,
              background:     '#1C1C1C',
              border:         '1px solid #2A2A2A',
              borderRadius:   8,
              padding:        '0 12px',
              color:          '#F5F5F5',
              fontSize:       14,
              fontFamily:     'Inter, sans-serif',
              outline:        'none',
            }}
          />
        </div>

        {/* Article list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)',
              border:     '1px solid #EF4444',
              borderRadius: 8,
              padding:    '12px 16px',
              color:      '#EF4444',
              fontSize:   13,
            }}>
              {error}
            </div>
          )}

          {filtered.length === 0 && !loading && (
            <div style={{ textAlign: 'center', color: '#555555', paddingTop: 40, fontSize: 14 }}>
              Nenhum artigo encontrado
            </div>
          )}

          {filtered.map(article => (
            <ArticleCard
              key={article.article_id}
              article={article}
              isSelected={selectedId === article.article_id}
              isDirty={!!dirty[article.article_id]}
              newQty={dirty[article.article_id]}
              onClick={() => handleSelect(article.article_id)}
            />
          ))}
        </div>
      </div>

      {/* ── Right panel: keypad ───────────────────────────────── */}
      <div style={{
        background:     '#0F0F0F',
        padding:        24,
        display:        'flex',
        flexDirection:  'column',
        justifyContent: 'center',
        gap:            20,
        overflowY:      'auto',
      }}>
        {selected ? (
          <>
            {/* Article info header */}
            <div>
              <p style={{ fontSize: 11, color: '#555555', letterSpacing: '0.08em', marginBottom: 4 }}>
                A CONTAR
              </p>
              <h3 style={{ fontSize: 20, fontWeight: 700, color: '#F5F5F5', lineHeight: 1.2 }}>
                {selected.name}
              </h3>
              <p style={{ fontSize: 12, color: '#555555', marginTop: 4 }}>
                Par level:{' '}
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9A9A9A' }}>
                  {selected.par_level} {selected.unit}
                </span>
              </p>
            </div>

            {/* Success banner */}
            {saveSuccess && (
              <div style={{
                background:   'rgba(34, 197, 94, 0.1)',
                border:       '1px solid #22C55E',
                borderRadius: 8,
                padding:      '10px 14px',
                color:        '#22C55E',
                fontSize:     13,
                fontWeight:   600,
                textAlign:    'center',
              }}>
                ✓ Contagem guardada
              </div>
            )}

            <NumericKeypad
              value={currentValue}
              onChange={handleKeypadChange}
              onConfirm={saving ? undefined : handleConfirm}
              unit={selected.unit}
            />

            {saving && (
              <p style={{ textAlign: 'center', color: '#555555', fontSize: 13 }}>
                A guardar…
              </p>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', color: '#555555' }}>
            <p style={{ fontSize: 32, marginBottom: 12 }}>←</p>
            <p>Selecciona um artigo para contar</p>
          </div>
        )}
      </div>
    </div>
  )
}
