'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Article } from '@/types/database'
import { fetchAllArticles } from '@/lib/supabase'
import { useIsMobile } from '@/hooks/useIsMobile'
import ArticleForm from './ArticleForm'
import BulkImportPanel from './BulkImportPanel'
import AliasManagerPanel from './AliasManagerPanel'

type Mode = 'idle' | 'create' | 'edit' | 'bulk-import' | 'aliases'

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export default function ArticlesScreen() {
  const isMobile = useIsMobile()

  const [articles,     setArticles]     = useState<Article[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [search,       setSearch]       = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [mode,         setMode]         = useState<Mode>('idle')
  const [selected,     setSelected]     = useState<Article | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setArticles(await fetchAllArticles())
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao carregar artigos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = normalize(search)
    return articles.filter(a =>
      (showInactive || a.is_active) && (
        normalize(a.name).includes(q) ||
        normalize(a.category ?? '').includes(q)
      )
    )
  }, [articles, search, showInactive])

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, Article[]>()
    for (const a of filtered) {
      const cat = a.category ?? 'Sem categoria'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(a)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const handleSaved = (article: Article) => {
    setArticles(prev => {
      const idx = prev.findIndex(a => a.id === article.id)
      return idx >= 0
        ? prev.map(a => a.id === article.id ? article : a)
        : [article, ...prev]
    })
    setSelected(article)
    setMode('edit')
  }

  const handleSelect = (a: Article) => {
    setSelected(a)
    setMode('edit')
  }

  const showPanel = mode !== 'idle'
  const showList  = !isMobile || !showPanel

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--action)', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <p style={{ color: 'var(--text-subtle)', fontSize: 14 }}>A carregar artigos…</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  // ── List panel (shared between mobile and desktop) ─────────────────────────
  const listPanel = (
    <div style={{
      display:       'flex',
      flexDirection: 'column',
      borderRight:   '1px solid var(--border)',
      background:    'var(--bg)',
      height:        '100%',
      overflow:      'hidden',
    }}>
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Artigos</h2>
            <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
              {articles.filter(a => a.is_active).length} ativos
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setMode('aliases')}
              title="Aliases aprendidos"
              style={{ width: 44, height: 44, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-subtle)', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              ⌘
            </button>
            <button
              onClick={() => setMode('bulk-import')}
              style={{ height: 44, padding: '0 12px', borderRadius: 8, border: `1px solid var(--action-border)`, background: 'transparent', color: 'var(--action)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              + Importar
            </button>
            <button
              onClick={() => { setSelected(null); setMode('create') }}
              style={{ height: 44, padding: '0 14px', borderRadius: 8, border: 'none', background: 'var(--action)', color: 'var(--text-on-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              + Novo
            </button>
          </div>
        </div>
        <input
          type="text"
          placeholder="Pesquisar artigo ou categoria…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', height: 40, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '0 12px', color: 'var(--text)', fontSize: 14, outline: 'none' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--text-subtle)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Mostrar inativos
        </label>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {error && (
          <div style={{ background: 'var(--error-surface)', border: '1px solid var(--error-border)', borderRadius: 8, padding: '10px 14px', color: 'var(--error)', fontSize: 13, marginBottom: 8 }}>
            {error}
          </div>
        )}
        {filtered.length === 0 && (
          <p style={{ color: 'var(--text-subtle)', fontSize: 14, textAlign: 'center', paddingTop: 32 }}>
            Nenhum artigo encontrado
          </p>
        )}
        {grouped.map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-subtle)', letterSpacing: '0.08em', marginBottom: 6, paddingLeft: 2 }}>
              {cat.toUpperCase()}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {items.map(a => (
                <button
                  key={a.id}
                  onClick={() => handleSelect(a)}
                  style={{
                    width:        '100%',
                    textAlign:    'left',
                    padding:      '10px 14px',
                    borderRadius: 8,
                    border:       `1px solid ${selected?.id === a.id ? 'var(--action)' : 'var(--border)'}`,
                    background:   selected?.id === a.id ? 'var(--action-surface)' : 'var(--surface)',
                    cursor:       'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: a.is_active ? 'var(--text)' : 'var(--text-subtle)' }}>
                      {a.name}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-subtle)' }}>
                        {a.unit}
                      </span>
                      {!a.is_active && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', background: 'var(--border)', padding: '2px 6px', borderRadius: 4, letterSpacing: '0.05em' }}>
                          INATIVO
                        </span>
                      )}
                    </div>
                  </div>
                  {a.par_level > 0 && (
                    <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
                      Par:{' '}
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
                        {a.par_level} {a.unit}
                      </span>
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  // ── Right panel content ────────────────────────────────────────────────────
  const rightPanel = (
    <div style={{ background: mode === 'aliases' ? 'var(--bg)' : 'var(--primary)', display: 'flex', flexDirection: 'column', height: '100%', overflowY: mode === 'bulk-import' ? 'hidden' : 'auto', padding: mode === 'bulk-import' || mode === 'aliases' ? 0 : '24px 20px' }}>
      {mode === 'bulk-import' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '24px 20px' }}>
          <BulkImportPanel
            articles={articles}
            onCancel={() => setMode('idle')}
            onBatchCreated={() => { load(); setMode('idle') }}
          />
        </div>
      )}
      {(mode === 'create' || mode === 'edit') && (
        <ArticleForm
          key={mode === 'edit' ? (selected?.id ?? 'edit') : 'new'}
          existing={mode === 'edit' ? selected ?? undefined : undefined}
          articles={articles}
          onSaved={handleSaved}
          onCancel={() => { setMode('idle'); setSelected(null) }}
        />
      )}
      {mode === 'aliases' && (
        <AliasManagerPanel onClose={() => setMode('idle')} />
      )}
      {mode === 'idle' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: 'var(--text-on-primary-faint)', fontSize: 14 }}>Seleciona ou cria um artigo</p>
        </div>
      )}
    </div>
  )

  // ── Mobile ─────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ height: '100%', background: 'var(--bg)' }}>
        {showList  && listPanel}
        {showPanel && rightPanel}
      </div>
    )
  }

  // ── Desktop: list is the main area, right panel is the supporting sidebar ──
  return (
    <div style={{
      display:             'grid',
      gridTemplateColumns: 'minmax(0, 1fr) 460px',
      height:              '100%',
      overflow:            'hidden',
    }}>
      {listPanel}
      {rightPanel}
    </div>
  )
}
