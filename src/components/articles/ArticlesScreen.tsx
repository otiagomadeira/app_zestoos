'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { Article } from '@/types/database'
import { fetchAllArticles } from '@/lib/supabase'
import { archiveArticles } from '@/lib/articles'
import { useIsMobile } from '@/hooks/useIsMobile'
import { ARTICLE_CATEGORIES, normalizeCanonicalCategory } from '@/lib/categoryKeywords'
import { searchMatch } from '@/lib/search'
import FloatingSearch from '@/components/inventory/FloatingSearch'
import ArticleForm from './ArticleForm'
import BulkImportPanel from './BulkImportPanel'

// Mode 'aliases' foi retirado intencionalmente desta UI: o gestor
// (AliasManagerPanel) é aprendizagem interna da Zesto, não fluxo diário do
// chef. Componente fica em disco para futura reutilização em /definicoes
// → "Aprendizagem da Zesto". A aprendizagem automática (useOrgAliases em
// ArticleForm) continua activa — só o gestor visual deixou de ser visível.
type Mode = 'idle' | 'create' | 'edit' | 'bulk-import'

type StatusFilter = 'active' | 'archived'

const STATUS_LABEL: Record<StatusFilter, string> = {
  active:   'Ativos',
  archived: 'Arquivados',
}

export default function ArticlesScreen() {
  const isMobile = useIsMobile()

  const [articles,         setArticles]         = useState<Article[]>([])
  const [loading,          setLoading]          = useState(true)
  const [error,            setError]            = useState<string | null>(null)
  const [mode,             setMode]             = useState<Mode>('idle')
  const [selected,         setSelected]         = useState<Article | null>(null)
  const [addMenuOpen,      setAddMenuOpen]      = useState(false)
  const addMenuRef                              = useRef<HTMLDivElement | null>(null)

  // Filtros — espelham o padrão Inventário (chips de categoria + segmented de
  // estado + FAB de pesquisa). Default 'active' porque na UI de Artigos o
  // utilizador quase sempre quer ver só o que está em uso.
  const [searchQuery,      setSearchQuery]      = useState<string>('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [statusFilter,     setStatusFilter]     = useState<StatusFilter>('active')

  // Modo Selecionar — apenas activado na tab Ativos. Permite arquivar em bulk
  // sem precisar de abrir cada artigo. Restaurar continua a ser feito 1-a-1
  // via ArticleForm (decisão D2: evitar ruído visual no card).
  const [selectionMode,    setSelectionMode]    = useState(false)
  const [selectedIds,      setSelectedIds]      = useState<Set<string>>(new Set())
  const [bulkArchiving,    setBulkArchiving]    = useState(false)

  useEffect(() => {
    if (!addMenuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAddMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [addMenuOpen])

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

  const exitSelection = useCallback(() => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }, [])

  // Mudar de tab ou abrir um detalhe sai do modo seleção — caso contrário
  // ficaríamos com checkboxes em Arquivados (sem efeito) ou sobre um artigo
  // que está em edição.
  useEffect(() => {
    if (selectionMode && statusFilter !== 'active') exitSelection()
  }, [statusFilter, selectionMode, exitSelection])

  useEffect(() => {
    if (selectionMode && mode !== 'idle') exitSelection()
  }, [mode, selectionMode, exitSelection])

  const hasUncategorized = useMemo(
    () => articles.some(a => normalizeCanonicalCategory(a.category) === null),
    [articles]
  )

  // Lista exibida — pipeline plano: search → categoria → estado → sort.
  // Sem agrupamento por categoria (decisão de produto: mais consistente com
  // Inventário e mais legível em listas longas).
  const displayed = useMemo(() => {
    const byName = (a: Article, b: Article) => a.name.localeCompare(b.name, 'pt')
    let pool = articles

    const q = searchQuery.trim()
    if (q.length > 0) {
      pool = pool.filter(a => searchMatch(q, a.name) || searchMatch(q, a.category ?? ''))
    }

    if (selectedCategory === '__none__') {
      pool = pool.filter(a => normalizeCanonicalCategory(a.category) === null)
    } else if (selectedCategory) {
      pool = pool.filter(a => normalizeCanonicalCategory(a.category) === selectedCategory)
    }

    pool = pool.filter(a => statusFilter === 'active' ? a.is_active : !a.is_active)

    return pool.slice().sort(byName)
  }, [articles, searchQuery, selectedCategory, statusFilter])

  const activeCount   = useMemo(() => articles.filter(a =>  a.is_active).length, [articles])
  const archivedCount = useMemo(() => articles.filter(a => !a.is_active).length, [articles])
  const visibleCount  = statusFilter === 'active' ? activeCount : archivedCount

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

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleBulkArchive = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const msg = `Arquivar ${ids.length} ${ids.length === 1 ? 'artigo' : 'artigos'}? `
              + (ids.length === 1 ? 'Ele deixa' : 'Eles deixam')
              + ' de aparecer no inventário e encomendas.'
    if (!confirm(msg)) return

    setBulkArchiving(true)
    setError(null)
    try {
      await archiveArticles(ids)
      const stamp = new Date().toISOString()
      setArticles(prev => prev.map(a => selectedIds.has(a.id)
        ? { ...a, is_active: false, updated_at: stamp }
        : a
      ))
      exitSelection()
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao arquivar artigos')
    } finally {
      setBulkArchiving(false)
    }
  }

  const showPanel = mode !== 'idle'
  const showList  = !isMobile || !showPanel

  // ── List panel ─────────────────────────────────────────────────────────────
  const listPanel = (
    <div style={{
      display:       'flex',
      flexDirection: 'column',
      borderRight:   isMobile ? 'none' : '1px solid var(--border)',
      background:    'var(--bg)',
      height:        '100%',
      overflow:      'hidden',
      position:      'relative',
    }}>
      {/* Header — duas linhas:
          1) Título + contagem | "+ Adicionar" (ou "Cancelar" em modo seleção)
          2) Segmented [Ativos|Arquivados] | "Selecionar" (só em Ativos)        */}
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
              {selectionMode ? `${selectedIds.size} selecionado${selectedIds.size === 1 ? '' : 's'}` : 'Artigos'}
            </h2>
            {!loading && !selectionMode && (
              <>
                <span aria-hidden="true" style={{ fontSize: 14, color: 'var(--text-subtle)' }}>·</span>
                <span style={{ fontSize: 14, color: 'var(--text-subtle)', fontFamily: 'var(--font-mono), monospace' }}>
                  {visibleCount}
                </span>
              </>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {selectionMode ? (
              <button
                type="button"
                onClick={exitSelection}
                disabled={bulkArchiving}
                style={ghostButtonStyle}
              >
                Cancelar
              </button>
            ) : (
              <div ref={addMenuRef} style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setAddMenuOpen(o => !o)}
                  aria-haspopup="menu"
                  aria-expanded={addMenuOpen}
                  aria-label="Adicionar artigo"
                  style={{
                    height:       'var(--touch-min)',
                    padding:      '0 12px',
                    borderRadius: 8,
                    border:       'none',
                    background:   'var(--action)',
                    color:        'var(--text-on-primary)',
                    fontSize:     13,
                    fontWeight:   600,
                    cursor:       'pointer',
                    display:      'flex',
                    alignItems:   'center',
                    gap:          6,
                    touchAction:  'manipulation',
                    whiteSpace:   'nowrap',
                  }}
                >
                  + Adicionar
                  <span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
                </button>

                {addMenuOpen && (
                  <div
                    role="menu"
                    style={{
                      position:      'absolute',
                      top:           'calc(100% + 6px)',
                      right:         0,
                      zIndex:        50,
                      minWidth:      200,
                      maxWidth:      'calc(100vw - 32px)',
                      background:    'var(--surface)',
                      border:        '1px solid var(--border)',
                      borderRadius:  10,
                      boxShadow:     '0 8px 24px var(--border)',
                      padding:       4,
                      display:       'flex',
                      flexDirection: 'column',
                      gap:           2,
                    }}
                  >
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => { setSelected(null); setMode('create'); setAddMenuOpen(false) }}
                      style={menuItemStyle}
                    >
                      Escrever artigo
                    </button>
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => { setMode('bulk-import'); setAddMenuOpen(false) }}
                      style={menuItemStyle}
                    >
                      Colar lista
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Linha 2 do header: filtro + Selecionar. Escondida em modo seleção. */}
        {!selectionMode && (
          <div style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            gap:            12,
            marginBottom:   10,
            minHeight:      'var(--touch-min)',
          }}>
            <SegmentedFilter
              value={statusFilter}
              onChange={setStatusFilter}
              activeCount={activeCount}
              archivedCount={archivedCount}
            />
            {statusFilter === 'active' && articles.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  // Fecha qualquer form aberto antes de entrar em modo seleção,
                  // caso contrário o useEffect "exit on mode change" cancela.
                  setMode('idle')
                  setSelected(null)
                  setSelectionMode(true)
                  setSelectedIds(new Set())
                }}
                style={ghostButtonStyle}
              >
                Selecionar
              </button>
            )}
          </div>
        )}

        {/* Chips de categoria — copy do InventoryScreen para manter consistência
            visual sem extrair componente partilhado nesta primeira passada. */}
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

      {/* Lista plana — sem section headers */}
      <div style={{
        flex:          1,
        overflowY:     'auto',
        padding:       '8px 12px 16px',
        display:       'flex',
        flexDirection: 'column',
        gap:           6,
      }}>
        {/* Loading local: spinner ocupa apenas a área da lista para não trocar
            o layout inteiro (header + chips + cards) quando os dados chegam. */}
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                border: '3px solid var(--border)', borderTopColor: 'var(--action)',
                animation: 'spin 0.8s linear infinite', margin: '0 auto 16px',
              }} />
              <p style={{ color: 'var(--text-subtle)', fontSize: 14 }}>A carregar artigos…</p>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        ) : (
          <>
            {error && (
              <div style={{ background: 'var(--error-surface)', border: '1px solid var(--error-border)', borderRadius: 8, padding: '10px 14px', color: 'var(--error)', fontSize: 13 }}>
                {error}
              </div>
            )}
            {statusFilter === 'archived' && displayed.length > 0 && (
              <div style={{
                padding:      '10px 14px',
                fontSize:     13,
                lineHeight:   1.45,
                color:        'var(--text-muted)',
                background:   'var(--surface)',
                border:       '1px solid var(--border)',
                borderRadius: 8,
                marginBottom: 4,
              }}>
                Artigos arquivados não aparecem no inventário nem nas encomendas. Abre um artigo para restaurar.
              </div>
            )}
            {displayed.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-subtle)', paddingTop: 40, fontSize: 14 }}>
                {searchQuery.trim().length > 0
                  ? `Sem resultados para "${searchQuery.trim()}".`
                  : statusFilter === 'archived'
                    ? 'Nenhum artigo arquivado.'
                    : 'Nenhum artigo encontrado'}
              </div>
            )}
            {displayed.map(a => (
              <ArticleListCard
                key={a.id}
                article={a}
                isSelected={selected?.id === a.id}
                selectionMode={selectionMode}
                isChecked={selectedIds.has(a.id)}
                onSelect={() => handleSelect(a)}
                onToggle={() => toggleSelected(a.id)}
              />
            ))}
          </>
        )}
        {/* Padding extra no fundo para o último card não ficar coberto pela
            FAB de pesquisa ou pela barra de seleção. */}
        <div style={{ height: 80, flexShrink: 0 }} aria-hidden="true" />
      </div>

      {selectionMode ? (
        <SelectionBar
          count={selectedIds.size}
          loading={bulkArchiving}
          onCancel={exitSelection}
          onArchive={handleBulkArchive}
        />
      ) : (
        <FloatingSearch query={searchQuery} onChange={setSearchQuery} />
      )}
    </div>
  )

  // ── Right panel ────────────────────────────────────────────────────────────
  // Tanto detalhe (ArticleForm) como bulk (BulkImportPanel) partilham a
  // superfície cremosa da lista. Identidade visual única: o que muda é a
  // densidade interna, não a cor de base. Preparado para futuro modo
  // claro/escuro — tokens semânticos (--bg/--surface/--text) flipam juntos.
  const rightPanel = (
    <div style={{
      background:     'var(--bg)',
      display:        'flex',
      flexDirection:  'column',
      height:         '100%',
      overflow:       'hidden',
    }}>
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
      {mode === 'idle' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <p style={{ color: 'var(--text-subtle)', fontSize: 14 }}>Seleciona ou cria um artigo</p>
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

  // ── Desktop ────────────────────────────────────────────────────────────────
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

// ── Card ─────────────────────────────────────────────────────────────────────

interface ArticleListCardProps {
  article:       Article
  isSelected:    boolean
  selectionMode: boolean
  isChecked:     boolean
  onSelect:      () => void
  onToggle:      () => void
}

function ArticleListCard({ article, isSelected, selectionMode, isChecked, onSelect, onToggle }: ArticleListCardProps) {
  // Card compacto, single-row — espelha o pattern visual do Inventário:
  // alinhamento vertical centrado (alignItems:center) e nome em flex:1.
  // Stock mínimo / par level NÃO aparece aqui — esta lista é gestão de
  // artigos, não monitorização de stock. Quem precisa, abre o detalhe.
  //
  // <div role="button"> em vez de <button> nativo para evitar o bug do
  // iOS Safari que colapsava cards multi do Inventário (button + flex
  // children ignora min-height — ver commit 5f3ec50).
  const handleClick = () => {
    if (selectionMode) onToggle()
    else onSelect()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }

  const dimmedName = !article.is_active

  return (
    <div
      role={selectionMode ? 'checkbox' : 'button'}
      aria-checked={selectionMode ? isChecked : undefined}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-pressed={!selectionMode ? isSelected : undefined}
      style={{
        width:        '100%',
        background:   isChecked
                        ? 'var(--action-surface)'
                        : isSelected && !selectionMode
                          ? 'var(--action-surface)'
                          : 'var(--surface)',
        border:       `1px solid ${isChecked || (isSelected && !selectionMode) ? 'var(--action)' : 'var(--border)'}`,
        borderRadius: 10,
        padding:      '8px 12px',
        minHeight:    56,
        flexShrink:   0,
        display:      'flex',
        alignItems:   'center',
        gap:          10,
        cursor:       'pointer',
        touchAction:  'manipulation',
        textAlign:    'left',
        boxShadow:    (isChecked || (isSelected && !selectionMode)) ? '0 4px 14px rgba(196, 106, 45, 0.18)' : 'none',
        transition:   'box-shadow 0.18s, border-color 0.15s, background 0.15s',
      }}
    >
      {selectionMode && (
        <span
          aria-hidden="true"
          style={{
            width:        20,
            height:       20,
            borderRadius: 4,
            border:       `2px solid ${isChecked ? 'var(--action)' : 'var(--text-subtle)'}`,
            background:   isChecked ? 'var(--action)' : 'transparent',
            color:        'var(--text-on-primary)',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            fontSize:     12,
            fontWeight:   700,
            flexShrink:   0,
          }}
        >
          {isChecked ? '✓' : ''}
        </span>
      )}
      <span style={{
        flex:         1,
        minWidth:     0,
        fontSize:     15,
        fontWeight:   600,
        color:        dimmedName ? 'var(--text-subtle)' : 'var(--text)',
        whiteSpace:   'nowrap',
        overflow:     'hidden',
        textOverflow: 'ellipsis',
      }}>
        {article.name}
      </span>
      {!article.is_active && (
        <span style={{
          fontSize:      9,
          fontWeight:    700,
          letterSpacing: 0.5,
          color:         'var(--text-subtle)',
          background:    'var(--bg)',
          border:        '1px solid var(--border)',
          borderRadius:  4,
          padding:       '1px 5px',
          flexShrink:    0,
        }}>
          ARQUIVADO
        </span>
      )}
      <span style={{
        fontSize:    12,
        color:       'var(--text-muted)',
        fontFamily:  'var(--font-mono), monospace',
        flexShrink:  0,
      }}>
        {article.unit}
      </span>
    </div>
  )
}

// ── Segmented filter (Ativos | Arquivados) ───────────────────────────────────

function SegmentedFilter({
  value,
  onChange,
  activeCount,
  archivedCount,
}: {
  value:         StatusFilter
  onChange:      (next: StatusFilter) => void
  activeCount:   number
  archivedCount: number
}) {
  const options: { key: StatusFilter; count: number }[] = [
    { key: 'active',   count: activeCount   },
    { key: 'archived', count: archivedCount },
  ]
  return (
    <div
      role="tablist"
      aria-label="Filtrar por estado"
      style={{
        display:      'inline-flex',
        background:   'var(--surface)',
        border:       '1px solid var(--border)',
        borderRadius: 8,
        padding:      2,
        gap:          2,
        flexShrink:   0,
      }}
    >
      {options.map(({ key, count }) => {
        const active = key === value
        return (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(key)}
            style={{
              minHeight:    'calc(var(--touch-min) - 4px)',
              padding:      '0 12px',
              borderRadius: 6,
              border:       'none',
              background:   active ? 'var(--bg)' : 'transparent',
              color:        active ? 'var(--text)' : 'var(--text-muted)',
              fontSize:     13,
              fontWeight:   active ? 700 : 500,
              cursor:       'pointer',
              touchAction:  'manipulation',
              whiteSpace:   'nowrap',
              display:      'flex',
              alignItems:   'center',
              gap:          6,
              boxShadow:    active ? '0 1px 3px rgba(28, 20, 10, 0.12)' : 'none',
              transition:   'background 0.15s, color 0.15s',
            }}
          >
            {STATUS_LABEL[key]}
            <span style={{
              fontFamily: 'var(--font-mono), monospace',
              fontSize:   11,
              color:      active ? 'var(--text-muted)' : 'var(--text-subtle)',
              fontWeight: 500,
            }}>
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── Selection bar (bottom) ───────────────────────────────────────────────────

function SelectionBar({
  count,
  loading,
  onCancel,
  onArchive,
}: {
  count:     number
  loading:   boolean
  onCancel:  () => void
  onArchive: () => void
}) {
  const disabled = count === 0 || loading
  return (
    <div
      role="toolbar"
      aria-label="Acções de seleção"
      style={{
        position:       'absolute',
        bottom:         0,
        left:           0,
        right:          0,
        background:     'var(--surface)',
        borderTop:      '1px solid var(--border)',
        padding:        '10px 14px',
        display:        'flex',
        gap:            8,
        alignItems:     'center',
        boxShadow:      '0 -4px 16px rgba(28, 20, 10, 0.08)',
        zIndex:         40,
      }}
    >
      <button
        type="button"
        onClick={onCancel}
        disabled={loading}
        style={{
          ...ghostButtonStyle,
          flexShrink: 0,
        }}
      >
        Cancelar
      </button>
      <button
        type="button"
        onClick={onArchive}
        disabled={disabled}
        style={{
          flex:         1,
          height:       'var(--touch-min)',
          padding:      '0 16px',
          borderRadius: 8,
          border:       'none',
          background:   disabled ? 'var(--surface-2)' : 'var(--action)',
          color:        disabled ? 'var(--text-subtle)' : 'var(--text-on-primary)',
          fontSize:     14,
          fontWeight:   600,
          cursor:       disabled ? 'not-allowed' : 'pointer',
          touchAction:  'manipulation',
          whiteSpace:   'nowrap',
        }}
      >
        {loading ? 'A arquivar…' : `Arquivar ${count}`}
      </button>
    </div>
  )
}

// ── Category chip ────────────────────────────────────────────────────────────

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

const menuItemStyle: React.CSSProperties = {
  height:        44,
  padding:       '0 12px',
  textAlign:     'left',
  borderRadius:  6,
  border:        'none',
  background:    'transparent',
  color:         'var(--text)',
  fontSize:      14,
  cursor:        'pointer',
  touchAction:   'manipulation',
}

const ghostButtonStyle: React.CSSProperties = {
  height:       'var(--touch-min)',
  padding:      '0 12px',
  borderRadius: 8,
  border:       '1px solid var(--border)',
  background:   'var(--surface)',
  color:        'var(--text)',
  fontSize:     13,
  fontWeight:   600,
  cursor:       'pointer',
  touchAction:  'manipulation',
  whiteSpace:   'nowrap',
}
