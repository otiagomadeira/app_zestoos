'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { CurrentStock } from '@/types/database'
import { fetchCurrentStock } from '@/lib/supabase'
import { fetchPackagings, recordStockCount, type Packaging, type CountLine } from '@/lib/stockCount'
import { useCurrentOrgId } from '@/hooks/useCurrentOrgId'
import { useInventorySession } from '@/hooks/useInventorySession'
import { ARTICLE_CATEGORIES, normalizeCanonicalCategory } from '@/lib/categoryKeywords'
import { searchMatch } from '@/lib/search'
import ArticleCard from './ArticleCard'

export default function InventoryScreen() {
  const [articles,    setArticles]    = useState<CurrentStock[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [selectedId,  setSelectedId]  = useState<string | null>(null)
  const [packagings,  setPackagings]  = useState<Packaging[] | null>(null)
  const [savingId,    setSavingId]    = useState<string | null>(null)
  // Guard síncrono contra double-tap em Guardar.
  const submitInFlight = useRef(false)

  const orgId = useCurrentOrgId()
  const {
    counted: countedThisSession,
    skipped: skippedThisSession,
    addCounted,
    addSkipped,
  } = useInventorySession(orgId)

  const [search,              setSearch]              = useState('')
  const [selectedCategory,    setSelectedCategory]    = useState<string | null>(null)
  const [selectedCountStatus, setSelectedCountStatus] = useState<'uncounted' | 'counted' | 'all'>('uncounted')
  const [saveSuccess,         setSaveSuccess]         = useState<string | null>(null)
  const [saveNoChange,        setSaveNoChange]        = useState<string | null>(null)

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

  // Sempre que muda o artigo seleccionado, refaz o fetch das embalagens.
  // Limpa primeiro para forçar o sheet a mostrar "A carregar embalagens…"
  // entre artigos diferentes em vez de exibir as do anterior.
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

  // Lista de chips é fixa (ARTICLE_CATEGORIES). Só calculamos se existem
  // artigos sem categoria mapeável → mostra chip "Sem categoria".
  const hasUncategorized = useMemo(
    () => articles.some(a => normalizeCanonicalCategory(a.category) === null),
    [articles]
  )

  // Lista exibida = articles → search → categoria → estado.
  // 'uncounted'  = não-contados (skipped vão ao fim)
  // 'counted'    = contados nesta sessão
  // 'all'        = activos → skipped → contados (estado-ortogonal, alfabético dentro)
  const displayed = useMemo(() => {
    const byName = (a: CurrentStock, b: CurrentStock) => a.name.localeCompare(b.name, 'pt')

    let pool = articles
    if (search.trim()) {
      pool = pool.filter(a => searchMatch(search, a.name))
    }
    if (selectedCategory === '__none__') {
      pool = pool.filter(a => normalizeCanonicalCategory(a.category) === null)
    } else if (selectedCategory) {
      pool = pool.filter(a => normalizeCanonicalCategory(a.category) === selectedCategory)
    }

    const isCountedSess = (a: CurrentStock) =>
      countedThisSession.has(a.article_id) && !skippedThisSession.has(a.article_id)
    const isSkippedSess = (a: CurrentStock) => skippedThisSession.has(a.article_id)

    if (selectedCountStatus === 'counted') {
      return pool.filter(isCountedSess).sort(byName)
    }
    if (selectedCountStatus === 'uncounted') {
      const notCounted = pool.filter(a => !countedThisSession.has(a.article_id))
      const active     = notCounted.filter(a => !isSkippedSess(a)).sort(byName)
      const skipped    = notCounted.filter(isSkippedSess).sort(byName)
      return [...active, ...skipped]
    }
    const active  = pool.filter(a =>
      !countedThisSession.has(a.article_id) && !isSkippedSess(a)
    ).sort(byName)
    const skipped = pool.filter(a =>
      isSkippedSess(a) && !countedThisSession.has(a.article_id)
    ).sort(byName)
    const counted = pool.filter(isCountedSess).sort(byName)
    return [...active, ...skipped, ...counted]
  }, [articles, search, selectedCategory, selectedCountStatus, countedThisSession, skippedThisSession])

  const selectedArticle = useMemo(
    () => articles.find(a => a.article_id === selectedId) ?? null,
    [articles, selectedId],
  )

  const handleToggle = useCallback((id: string) => {
    setSelectedId(prev => prev === id ? null : id)
  }, [])

  const advanceToNext = useCallback((fromId: string) => {
    const idx = displayed.findIndex(a => a.article_id === fromId)
    for (let i = idx + 1; i < displayed.length; i++) {
      const candidate = displayed[i]
      if (
        !countedThisSession.has(candidate.article_id) &&
        !skippedThisSession.has(candidate.article_id)
      ) {
        setSelectedId(candidate.article_id)
        return
      }
    }
    setSelectedId(null)
  }, [displayed, countedThisSession, skippedThisSession])

  const handleSave = useCallback(async (lines: CountLine[]) => {
    if (submitInFlight.current) return
    if (!selectedArticle) return

    const articleId = selectedArticle.article_id
    submitInFlight.current = true
    setSavingId(articleId)
    try {
      const result = await recordStockCount(articleId, lines)
      if (result.saved) {
        // Recarrega para reflectir current_qty actualizado e mover o artigo
        // para a secção "contados" da sessão.
        await load()
        setSaveSuccess(articleId)
        addCounted(articleId)
        setTimeout(() => setSaveSuccess(null), 1500)
        advanceToNext(articleId)
      } else {
        setSaveNoChange(articleId)
        setTimeout(() => setSaveNoChange(null), 1500)
        setSelectedId(null)
      }
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao guardar')
    } finally {
      setSavingId(null)
      submitInFlight.current = false
    }
  }, [selectedArticle, load, advanceToNext, addCounted])

  const handleSkip = useCallback(() => {
    if (!selectedArticle) return
    const articleId = selectedArticle.article_id
    addSkipped(articleId)
    advanceToNext(articleId)
  }, [selectedArticle, advanceToNext, addSkipped])

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

      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Contagem de Stock</h2>
            <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
              {articles.length} artigos
            </p>
          </div>
        </div>
        <input
          type="text"
          placeholder="Pesquisar artigo…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
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

        <div
          role="tablist"
          aria-label="Filtrar por categoria"
          style={{
            display:                 'flex',
            gap:                     6,
            overflowX:               'auto',
            overflowY:               'hidden',
            margin:                  '12px -20px 0',
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

        <div
          role="tablist"
          aria-label="Filtrar por estado de contagem"
          style={{
            display:      'flex',
            height:       48,
            background:   'var(--surface)',
            borderRadius: 10,
            border:       '1px solid var(--border)',
            padding:      2,
            gap:          2,
            marginTop:    8,
          }}
        >
          {([
            { key: 'uncounted', label: 'Por contar' },
            { key: 'counted',   label: 'Contados'   },
            { key: 'all',       label: 'Todos'      },
          ] as const).map(opt => {
            const active = selectedCountStatus === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedCountStatus(opt.key)}
                style={{
                  flex:         1,
                  height:       '100%',
                  borderRadius: 8,
                  border:       'none',
                  background:   active ? 'var(--bg)' : 'transparent',
                  color:        active ? 'var(--text)' : 'var(--text-muted)',
                  fontSize:     13,
                  fontWeight:   active ? 700 : 500,
                  cursor:       'pointer',
                  touchAction:  'manipulation',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

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
        {displayed.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-subtle)', paddingTop: 40, fontSize: 14 }}>
            {selectedCountStatus === 'uncounted' && countedThisSession.size > 0
              ? 'Tudo contado nesta sessão.'
              : 'Nenhum artigo encontrado'}
          </div>
        )}
        {displayed.map(article => {
          const id = article.article_id
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
                  Sem alteração — valor igual ao actual
                </div>
              )}
              <ArticleCard
                article={article}
                isExpanded={selectedId === id}
                packagings={selectedId === id ? packagings : null}
                isCounted={countedThisSession.has(id)}
                isSkipped={skippedThisSession.has(id)}
                isSaving={savingId === id}
                onToggle={() => handleToggle(id)}
                onSkip={handleSkip}
                onSave={handleSave}
              />
            </div>
          )
        })}
      </div>
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
        height:       'var(--touch-min)',
        minHeight:    44,
        padding:      '0 16px',
        borderRadius: 22,
        border:       `1px solid ${active ? 'var(--action)' : 'var(--border)'}`,
        background:   active ? 'var(--action-surface)' : 'var(--surface)',
        color:        active ? 'var(--action)' : 'var(--text-muted)',
        fontSize:     13,
        fontWeight:   active ? 600 : 500,
        whiteSpace:   'nowrap',
        cursor:       'pointer',
        touchAction:  'manipulation',
      }}
    >
      {label}
    </button>
  )
}
