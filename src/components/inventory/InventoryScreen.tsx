'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import type { CurrentStock } from '@/types/database'
import { fetchCurrentStock } from '@/lib/supabase'
import { fetchPackagings, type Packaging } from '@/lib/stockCount'
import { useCurrentOrgId } from '@/hooks/useCurrentOrgId'
import { useInventorySession } from '@/hooks/useInventorySession'
import { ARTICLE_CATEGORIES, normalizeCanonicalCategory } from '@/lib/categoryKeywords'
import { searchMatch } from '@/lib/search'
import ArticleCard from './ArticleCard'
import FloatingSearch from './FloatingSearch'

export default function InventoryScreen() {
  const [articles,    setArticles]    = useState<CurrentStock[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [selectedId,  setSelectedId]  = useState<string | null>(null)
  const [packagings,  setPackagings]  = useState<Packaging[] | null>(null)

  const orgId = useCurrentOrgId()
  const {
    counted:   countedThisSession,
    sessionId,
    addCounted,
  } = useInventorySession(orgId)

  const [selectedCategory,    setSelectedCategory]    = useState<string | null>(null)
  const [selectedCountStatus, setSelectedCountStatus] = useState<'uncounted' | 'counted' | 'all'>('all')
  const [searchQuery,         setSearchQuery]         = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchCurrentStock()
      setArticles(data)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao carregar inventário')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Fetch das embalagens só para multi-embalagem (artigo seleccionado/expandido).
  useEffect(() => {
    if (!selectedId) { setPackagings(null); return }
    let cancelled = false
    setPackagings(null)
    fetchPackagings(selectedId)
      .then(rows => { if (!cancelled) setPackagings(rows) })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message ?? 'Erro ao carregar embalagens')
      })
    return () => { cancelled = true }
  }, [selectedId])

  const hasUncategorized = useMemo(
    () => articles.some(a => normalizeCanonicalCategory(a.category) === null),
    [articles]
  )

  // Lista exibida. Pipeline: search → categoria → estado → sort.
  // Default 'all' = alfabético puro, sem segmentação por estado (counted
  // aparece in-place com ✓ no card; mantém posição estável durante a sessão).
  const displayed = useMemo(() => {
    const byName = (a: CurrentStock, b: CurrentStock) => a.name.localeCompare(b.name, 'pt')

    let pool = articles

    const q = searchQuery.trim()
    if (q.length > 0) {
      pool = pool.filter(a => searchMatch(q, a.name))
    }

    if (selectedCategory === '__none__') {
      pool = pool.filter(a => normalizeCanonicalCategory(a.category) === null)
    } else if (selectedCategory) {
      pool = pool.filter(a => normalizeCanonicalCategory(a.category) === selectedCategory)
    }

    if (selectedCountStatus === 'counted') {
      return pool.filter(a => countedThisSession.has(a.article_id)).sort(byName)
    }
    if (selectedCountStatus === 'uncounted') {
      return pool.filter(a => !countedThisSession.has(a.article_id)).sort(byName)
    }
    return pool.slice().sort(byName)
  }, [articles, searchQuery, selectedCategory, selectedCountStatus, countedThisSession])

  const handleToggle = useCallback((id: string) => {
    setSelectedId(prev => prev === id ? null : id)
  }, [])

  // Callback partilhado pelo inline e multi após autosave OK. Apenas marca
  // como contado; não recarrega — manter o card no mesmo sítio durante a
  // sessão. Os hooks de autosave guardam o valor escrito em state interno;
  // o current_qty da DB foi actualizado pelo RPC para próximas sessões.
  const handleCounted = useCallback((articleId: string) => {
    addCounted(articleId)
  }, [addCounted])

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

      <div style={{ padding: '12px 20px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          gap:            12,
          marginBottom:   10,
          minHeight:      'var(--touch-min)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <h2 style={{
              fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              Contagem de Stock
            </h2>
            <span aria-hidden="true" style={{ fontSize: 14, color: 'var(--text-subtle)' }}>·</span>
            <span style={{ fontSize: 14, color: 'var(--text-subtle)', fontFamily: 'var(--font-mono), monospace' }}>
              {articles.length}
            </span>
          </div>
          <CountStatusDropdown
            value={selectedCountStatus}
            onChange={setSelectedCountStatus}
          />
        </div>

        <div
          role="tablist"
          aria-label="Filtrar por categoria"
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
          <CategoryChip label="Todas" active={selectedCategory === null} onClick={() => setSelectedCategory(null)} />
          {ARTICLE_CATEGORIES.map(c => (
            <CategoryChip
              key={c}
              label={c}
              active={selectedCategory === c}
              onClick={() => setSelectedCategory(c)}
            />
          ))}
          {hasUncategorized && (
            <CategoryChip
              label="Sem categoria"
              active={selectedCategory === '__none__'}
              onClick={() => setSelectedCategory('__none__')}
            />
          )}
        </div>
      </div>

      <div style={{
        flex:          1,
        overflowY:     'auto',
        padding:       '8px 12px 16px',
        display:       'flex',
        flexDirection: 'column',
        gap:           6,
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
        {displayed.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-subtle)', paddingTop: 40, fontSize: 14 }}>
            {searchQuery.trim().length > 0
              ? `Sem resultados para "${searchQuery.trim()}".`
              : selectedCountStatus === 'uncounted' && countedThisSession.size > 0
                ? 'Tudo contado nesta sessão.'
                : 'Nenhum artigo encontrado'}
          </div>
        )}
        {displayed.map(article => {
          const id = article.article_id
          return (
            <ArticleCard
              key={`${id}:${sessionId ?? 'pending'}`}
              article={article}
              isExpanded={selectedId === id}
              packagings={selectedId === id ? packagings : null}
              isCounted={countedThisSession.has(id)}
              sessionId={sessionId}
              onToggle={() => handleToggle(id)}
              onCounted={handleCounted}
            />
          )
        })}
        {/* Padding extra no fundo para o último card não ficar coberto pelo FAB. */}
        <div style={{ height: 80, flexShrink: 0 }} aria-hidden="true" />
      </div>

      <FloatingSearch query={searchQuery} onChange={setSearchQuery} />
    </div>
  )
}

type CountStatus = 'uncounted' | 'counted' | 'all'

const COUNT_STATUS_LABEL: Record<CountStatus, string> = {
  all:       'Todos',
  uncounted: 'Por contar',
  counted:   'Contados',
}

function CountStatusDropdown({
  value,
  onChange,
}: {
  value:    CountStatus
  onChange: (next: CountStatus) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Filtro: ${COUNT_STATUS_LABEL[value]}`}
        style={{
          minHeight:    'var(--touch-min)',
          padding:      '0 12px',
          borderRadius: 8,
          border:       '1px solid var(--border)',
          background:   'var(--surface)',
          color:        'var(--text)',
          fontSize:     13,
          fontWeight:   600,
          display:      'flex',
          alignItems:   'center',
          gap:          6,
          cursor:       'pointer',
          touchAction:  'manipulation',
          whiteSpace:   'nowrap',
        }}
      >
        <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Filtro:</span>
        <span>{COUNT_STATUS_LABEL[value]}</span>
        <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 2 }}>▾</span>
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            aria-hidden="true"
            style={{ position: 'fixed', inset: 0, zIndex: 50 }}
          />
          <div
            role="menu"
            style={{
              position:     'absolute',
              top:          'calc(100% + 4px)',
              right:        0,
              background:   'var(--surface-2)',
              border:       '1px solid var(--border)',
              borderRadius: 8,
              minWidth:     160,
              zIndex:       51,
              overflow:     'hidden',
              boxShadow:    '0 4px 16px var(--border)',
            }}
          >
            {(['all', 'uncounted', 'counted'] as const).map(opt => {
              const active = opt === value
              return (
                <button
                  key={opt}
                  type="button"
                  role="menuitem"
                  onClick={() => { onChange(opt); setOpen(false) }}
                  style={{
                    width:      '100%',
                    minHeight:  44,
                    padding:    '10px 14px',
                    background: active ? 'var(--bg)' : 'transparent',
                    border:     'none',
                    color:      'var(--text)',
                    fontSize:   14,
                    fontWeight: active ? 700 : 500,
                    textAlign:  'left',
                    cursor:     'pointer',
                    display:    'flex',
                    alignItems: 'center',
                    gap:        8,
                  }}
                >
                  {active && <span aria-hidden="true" style={{ color: 'var(--success)', fontWeight: 700 }}>✓</span>}
                  {!active && <span aria-hidden="true" style={{ width: 12, display: 'inline-block' }} />}
                  {COUNT_STATUS_LABEL[opt]}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label:    string
  active:   boolean
  onClick:  () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        flexShrink:   0,
        minHeight:    'var(--touch-min)',
        padding:      '0 14px',
        borderRadius: 22,
        border:       `1px solid ${active ? 'var(--action)' : 'var(--border)'}`,
        background:   active ? 'var(--action-surface)' : 'var(--surface)',
        color:        active ? 'var(--action)' : 'var(--text-muted)',
        fontSize:     13,
        fontWeight:   active ? 600 : 500,
        whiteSpace:   'nowrap',
        cursor:       'pointer',
        touchAction:  'manipulation',
        boxShadow:    active ? '0 3px 10px rgba(196, 106, 45, 0.18)' : 'none',
        transition:   'box-shadow 0.18s, background 0.15s',
      }}
    >
      {label}
    </button>
  )
}
