'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { Article } from '@/types/database'
import { fetchAllArticles } from '@/lib/supabase'
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

type StatusFilter = 'active' | 'all' | 'inactive'

const STATUS_LABEL: Record<StatusFilter, string> = {
  active:   'Ativos',
  all:      'Todos',
  inactive: 'Inativos',
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

  // Filtros — espelham o padrão Inventário (chips de categoria + dropdown de
  // estado + FAB de pesquisa). Default 'active' porque na UI de Artigos o
  // utilizador quase sempre quer ver só o que está em uso.
  const [searchQuery,      setSearchQuery]      = useState<string>('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [statusFilter,     setStatusFilter]     = useState<StatusFilter>('active')

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

    if (statusFilter === 'active')   pool = pool.filter(a =>  a.is_active)
    if (statusFilter === 'inactive') pool = pool.filter(a => !a.is_active)
    // 'all' → sem filtro

    return pool.slice().sort(byName)
  }, [articles, searchQuery, selectedCategory, statusFilter])

  const activeCount = useMemo(
    () => articles.filter(a => a.is_active).length,
    [articles]
  )

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
      {/* Header — espelha o padrão de Inventário (título+contagem · filtro de
          estado), com a única diferença de ter o "+ Adicionar" porque é a
          acção principal desta página. */}
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
              Artigos
            </h2>
            <span aria-hidden="true" style={{ fontSize: 14, color: 'var(--text-subtle)' }}>·</span>
            <span style={{ fontSize: 14, color: 'var(--text-subtle)', fontFamily: 'var(--font-mono), monospace' }}>
              {activeCount}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <StatusFilterDropdown value={statusFilter} onChange={setStatusFilter} />

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
          </div>
        </div>

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
        {error && (
          <div style={{ background: 'var(--error-surface)', border: '1px solid var(--error-border)', borderRadius: 8, padding: '10px 14px', color: 'var(--error)', fontSize: 13 }}>
            {error}
          </div>
        )}
        {displayed.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-subtle)', paddingTop: 40, fontSize: 14 }}>
            {searchQuery.trim().length > 0
              ? `Sem resultados para "${searchQuery.trim()}".`
              : 'Nenhum artigo encontrado'}
          </div>
        )}
        {displayed.map(a => (
          <ArticleListCard
            key={a.id}
            article={a}
            isSelected={selected?.id === a.id}
            onSelect={() => handleSelect(a)}
          />
        ))}
        {/* Padding extra no fundo para o último card não ficar coberto pelo FAB. */}
        <div style={{ height: 80, flexShrink: 0 }} aria-hidden="true" />
      </div>

      <FloatingSearch query={searchQuery} onChange={setSearchQuery} />
    </div>
  )

  // ── Right panel ────────────────────────────────────────────────────────────
  const rightPanel = (
    <div style={{
      background:     mode === 'bulk-import' ? 'var(--primary)' : 'var(--primary)',
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
  article:    Article
  isSelected: boolean
  onSelect:   () => void
}

function ArticleListCard({ article, isSelected, onSelect }: ArticleListCardProps) {
  // Card compacto — mesma forma do InlineCountRow do Inventário (min-height 56,
  // border 10), sem stepper. Conteúdo:
  //   linha 1: [nome flex] [INATIVO?] [unit pequena à direita]
  //   linha 2 (opcional, par_level > 0): "Par: X unit"
  //
  // Usa <div role="button"> em vez de <button> nativo para evitar o bug do
  // iOS Safari que colapsava cards multi do Inventário (button + flex children
  // ignora min-height — ver commit 5f3ec50).
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }

  const hasPar = article.par_level > 0
  const dimmedName = !article.is_active

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      aria-pressed={isSelected}
      style={{
        width:        '100%',
        background:   isSelected ? 'var(--action-surface)' : 'var(--surface)',
        border:       `1px solid ${isSelected ? 'var(--action)' : 'var(--border)'}`,
        borderRadius: 10,
        padding:      '8px 12px',
        minHeight:    56,
        flexShrink:   0,
        display:      'flex',
        flexDirection: 'column',
        gap:          2,
        cursor:       'pointer',
        touchAction:  'manipulation',
        textAlign:    'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 }}>
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
            INATIVO
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
      {hasPar && (
        <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
          Par:{' '}
          <span style={{ fontFamily: 'var(--font-mono), monospace', color: 'var(--text-muted)' }}>
            {article.par_level} {article.unit}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Status filter dropdown ───────────────────────────────────────────────────

function StatusFilterDropdown({
  value,
  onChange,
}: {
  value:    StatusFilter
  onChange: (next: StatusFilter) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Filtro: ${STATUS_LABEL[value]}`}
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
        <span>{STATUS_LABEL[value]}</span>
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
            {(['active', 'all', 'inactive'] as const).map(opt => {
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
                  {STATUS_LABEL[opt]}
                </button>
              )
            })}
          </div>
        </>
      )}
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
