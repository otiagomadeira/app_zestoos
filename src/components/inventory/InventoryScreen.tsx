'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { CurrentStock } from '@/types/database'
import { fetchCurrentStock, saveStockCount } from '@/lib/supabase'
import { useCurrentOrgId } from '@/hooks/useCurrentOrgId'
import { useInventorySession } from '@/hooks/useInventorySession'
import ArticleCard from './ArticleCard'
import Numpad from './Numpad'

export default function InventoryScreen() {
  const [articles,   setArticles]   = useState<CurrentStock[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [numpadValue, setNumpadValue] = useState<string>('')
  const [savingId,   setSavingId]   = useState<string | null>(null)
  // Guard síncrono contra double-tap em OK: setState é assíncrono, useRef
  // evita janela em que dois cliques sucessivos disparem dois saveStockCount
  // antes de savingId atualizar.
  const submitInFlight = useRef(false)
  // Sessão de contagem persistida em localStorage por org+data. Recarregar
  // mantém artigos contados/saltados marcados; à meia-noite local começa
  // sessão nova.
  const orgId = useCurrentOrgId()
  const {
    counted: countedThisSession,
    skipped: skippedThisSession,
    addCounted,
    addSkipped,
  } = useInventorySession(orgId)
  const [search,      setSearch]      = useState('')
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [saveNoChange, setSaveNoChange] = useState<string | null>(null)

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

  // Limpa o valor do numpad sempre que muda o artigo selecionado.
  // Garante que o valor digitado para um artigo não polui o seguinte.
  useEffect(() => { setNumpadValue('') }, [selectedId])

  const filtered = useMemo(() =>
    articles.filter(a =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.category ?? '').toLowerCase().includes(search.toLowerCase())
    ),
    [articles, search]
  )

  const sortedFiltered = useMemo(() => {
    const byName    = (a: CurrentStock, b: CurrentStock) => a.name.localeCompare(b.name, 'pt')
    const isHandled = (a: CurrentStock) =>
      countedThisSession.has(a.article_id) || skippedThisSession.has(a.article_id)
    const active    = filtered.filter(a => !isHandled(a))
    const skipped   = filtered.filter(a => skippedThisSession.has(a.article_id))
    const counted   = filtered.filter(a =>
      countedThisSession.has(a.article_id) && !skippedThisSession.has(a.article_id)
    )
    const belowPar  = active.filter(a => a.current_qty < a.par_level)
    const abovePar  = active.filter(a => a.current_qty >= a.par_level)
    return [
      ...belowPar.sort(byName),
      ...abovePar.sort(byName),
      ...skipped.sort(byName),
      ...counted.sort(byName),
    ]
  }, [filtered, countedThisSession, skippedThisSession])

  const selectedArticle = useMemo(
    () => articles.find(a => a.article_id === selectedId) ?? null,
    [articles, selectedId],
  )

  const handleSelect = (id: string) => {
    setSelectedId(prev => prev === id ? null : id)
  }

  // ── Numpad handlers (lógica espelhada de _test-numpad/page.tsx) ─────────────

  const handleDigit = useCallback((d: string) => {
    setNumpadValue(prev => {
      if (prev.length >= 6) return prev
      if (prev === '0' && d !== '.') return d
      return prev + d
    })
  }, [])

  const handleDecimal = useCallback(() => {
    setNumpadValue(prev => {
      if (prev.includes('.')) return prev
      return prev === '' ? '0.' : prev + '.'
    })
  }, [])

  const handleBackspace = useCallback(() => {
    setNumpadValue(prev => prev.slice(0, -1))
  }, [])

  const handleClose = useCallback(() => {
    setSelectedId(null)
  }, [])

  const advanceToNext = useCallback((fromId: string) => {
    const idx = sortedFiltered.findIndex(a => a.article_id === fromId)
    // Avança para o próximo ainda não tratado (nem contado, nem saltado).
    // Loop linear porque a lista já vem ordenada com handled no fim — sai cedo.
    for (let i = idx + 1; i < sortedFiltered.length; i++) {
      const candidate = sortedFiltered[i]
      if (
        !countedThisSession.has(candidate.article_id) &&
        !skippedThisSession.has(candidate.article_id)
      ) {
        setSelectedId(candidate.article_id)
        return
      }
    }
    setSelectedId(null)
  }, [sortedFiltered, countedThisSession, skippedThisSession])

  const handleConfirm = useCallback(async () => {
    // Guard síncrono: rejeita re-entry imediato (double-tap).
    if (submitInFlight.current) return
    if (!selectedArticle || !numpadValue) return
    const newQtyStock = parseFloat(numpadValue)
    if (isNaN(newQtyStock) || newQtyStock < 0) return

    // stock_unit → base_unit usando base_per_stock (vem da view current_stock,
    // que escolhe supplier preferred → article_size default → 1).
    const newQtyBase = newQtyStock * selectedArticle.base_per_stock
    const articleId  = selectedArticle.article_id

    submitInFlight.current = true
    setSavingId(articleId)
    try {
      const result = await saveStockCount(articleId, newQtyBase, selectedArticle.unit, selectedArticle.current_qty)
      if (result.saved) {
        setArticles(prev => prev.map(a =>
          a.article_id === articleId
            ? { ...a, current_qty: newQtyBase, diff_from_par: newQtyBase - a.par_level }
            : a
        ))
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
  }, [selectedArticle, numpadValue, advanceToNext, addCounted])

  const handleSkip = useCallback(() => {
    if (!selectedArticle) return
    const articleId = selectedArticle.article_id
    addSkipped(articleId)
    advanceToNext(articleId)
  }, [selectedArticle, advanceToNext, addSkipped])

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

      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Contagem de Stock</h2>
            <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
              {articles.length} artigos
              {belowPar > 0 && <span style={{ color: 'var(--error)', marginLeft: 8 }}>· {belowPar} abaixo do par</span>}
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
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-subtle)', paddingTop: 40, fontSize: 14 }}>
            Nenhum artigo encontrado
          </div>
        )}
        {sortedFiltered.map(article => {
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
                  Sem alteração — valor igual ao atual
                </div>
              )}
              <ArticleCard
                article={article}
                isExpanded={selectedId === id}
                isCounted={countedThisSession.has(id)}
                isSkipped={skippedThisSession.has(id)}
                isSaving={savingId === id}
                onClick={() => handleSelect(id)}
              />
            </div>
          )
        })}
      </div>

      {selectedArticle && (
        <Numpad
          articleName={selectedArticle.name}
          // currentQty mostrado em stock_unit (ex.: 2 caixas em vez de 360 ovos).
          currentQty={selectedArticle.current_qty / (selectedArticle.base_per_stock || 1)}
          unit={selectedArticle.stock_unit}
          value={numpadValue}
          saving={savingId === selectedArticle.article_id}
          onDigit={handleDigit}
          onDecimal={handleDecimal}
          onBackspace={handleBackspace}
          onOk={handleConfirm}
          onSkip={handleSkip}
          onClose={handleClose}
        />
      )}
    </div>
  )
}
