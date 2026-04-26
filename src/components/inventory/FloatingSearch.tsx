'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface FloatingSearchProps {
  query:    string
  onChange: (next: string) => void
}

/**
 * FAB de pesquisa + bottom sheet — padrão "search-on-demand".
 *
 * Decisão de UX:
 *   - Não rouba espaço permanente no header (a pesquisa é auxílio, não fluxo
 *     principal — o fluxo é contagem).
 *   - Acompanha a página via `position: fixed`. Sempre visível durante scroll.
 *   - Bottom-right alinha com a zona ergonómica do polegar quando o chef
 *     segura o telefone com uma mão (a outra está suja a contar).
 *   - 56×56 (acima do mínimo 44px) com contraste forte para mãos molhadas.
 *   - Sheet sobe do fundo com input autofocus → teclado iOS abre logo.
 *   - Quando há query activa, FAB expande para mostrar o termo (sinaliza
 *     "tens um filtro de pesquisa activo" com 1 toque para limpar).
 *
 * Ergonomia mobile:
 *   - `inputMode="search"` para teclado contextualizado iOS.
 *   - `enterKeyHint="search"` para botão "Procurar" no teclado.
 *   - `padding-bottom: env(safe-area-inset-bottom)` no sheet para iPhones
 *     com home indicator.
 */
export default function FloatingSearch({ query, onChange }: FloatingSearchProps) {
  const [open, setOpen] = useState<boolean>(false)
  const [draft, setDraft] = useState<string>(query)
  const inputRef = useRef<HTMLInputElement>(null)

  // Mantém o draft sincronizado quando o query externo muda (ex.: clear).
  useEffect(() => { setDraft(query) }, [query])

  // Autofocus quando abre (next tick para o sheet entrar em DOM primeiro).
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open])

  // Fecha em Escape (acessibilidade keyboard).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const apply = useCallback(() => {
    onChange(draft.trim())
    setOpen(false)
  }, [draft, onChange])

  const clear = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    setDraft('')
    onChange('')
  }, [onChange])

  const hasQuery = query.trim().length > 0

  return (
    <>
      {/* FAB — fixed bottom-right. Quando há query activa, expande para
          mostrar o termo + botão de limpar (1-toque clear). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={hasQuery ? `Pesquisa activa: ${query}. Toca para editar.` : 'Pesquisar artigo'}
        style={{
          position:       'fixed',
          right:          16,
          bottom:         `calc(16px + env(safe-area-inset-bottom, 0px))`,
          minHeight:      56,
          minWidth:       56,
          padding:        hasQuery ? '0 8px 0 16px' : 0,
          borderRadius:   28,
          border:         'none',
          background:     'var(--action)',
          color:          'var(--white)',
          fontSize:       hasQuery ? 14 : 22,
          fontWeight:     700,
          cursor:         'pointer',
          touchAction:    'manipulation',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            8,
          boxShadow:      '0 4px 16px var(--border)',
          zIndex:         40,
        }}
      >
        <SearchIcon />
        {hasQuery && (
          <>
            <span style={{
              maxWidth:     120,
              whiteSpace:   'nowrap',
              overflow:     'hidden',
              textOverflow: 'ellipsis',
              fontFamily:   'inherit',
            }}>{query}</span>
            <span
              role="button"
              aria-label="Limpar pesquisa"
              onClick={clear}
              style={{
                width:          32,
                height:         32,
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                borderRadius:   16,
                fontSize:       18,
                lineHeight:     1,
                marginRight:    -4,
                touchAction:    'manipulation',
              }}
            >×</span>
          </>
        )}
      </button>

      {/* Bottom sheet */}
      {open && (
        <>
          {/* Backdrop — toca para fechar sem aplicar */}
          <div
            onClick={() => setOpen(false)}
            aria-hidden="true"
            style={{
              position:   'fixed',
              inset:      0,
              background: 'rgba(0,0,0,0.3)',
              zIndex:     50,
            }}
          />
          <div
            role="dialog"
            aria-label="Pesquisar artigo"
            style={{
              position:     'fixed',
              left:         0,
              right:        0,
              bottom:       0,
              background:   'var(--surface)',
              borderTop:    '1px solid var(--border)',
              borderRadius: '16px 16px 0 0',
              padding:      `12px 16px calc(16px + env(safe-area-inset-bottom, 0px))`,
              zIndex:       51,
              display:      'flex',
              flexDirection: 'column',
              gap:          10,
            }}
          >
            <div style={{
              alignSelf:    'center',
              width:        40,
              height:       4,
              borderRadius: 2,
              background:   'var(--border)',
            }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width:          44,
                height:         44,
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                color:          'var(--text-muted)',
              }}>
                <SearchIcon />
              </span>
              <input
                ref={inputRef}
                type="search"
                inputMode="search"
                enterKeyHint="search"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') apply() }}
                placeholder="Pesquisar artigo…"
                aria-label="Termo de pesquisa"
                style={{
                  flex:        1,
                  minWidth:    0,
                  height:      48,
                  background:  'var(--bg)',
                  border:      '1px solid var(--border)',
                  borderRadius: 10,
                  padding:     '0 14px',
                  fontSize:    16,
                  color:       'var(--text)',
                  outline:     'none',
                }}
              />
              {draft.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDraft('')}
                  aria-label="Limpar campo"
                  style={{
                    width:          44,
                    height:         44,
                    border:         'none',
                    background:     'transparent',
                    color:          'var(--text-muted)',
                    fontSize:       22,
                    cursor:         'pointer',
                    touchAction:    'manipulation',
                    display:        'flex',
                    alignItems:     'center',
                    justifyContent: 'center',
                  }}
                >×</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  flex:         1,
                  minHeight:    'var(--touch-min)',
                  borderRadius: 10,
                  border:       '1px solid var(--border)',
                  background:   'transparent',
                  color:        'var(--text-muted)',
                  fontSize:     14,
                  fontWeight:   600,
                  cursor:       'pointer',
                  touchAction:  'manipulation',
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={apply}
                style={{
                  flex:         2,
                  minHeight:    'var(--touch-min)',
                  borderRadius: 10,
                  border:       'none',
                  background:   'var(--action)',
                  color:        'var(--white)',
                  fontSize:     15,
                  fontWeight:   700,
                  cursor:       'pointer',
                  touchAction:  'manipulation',
                }}
              >
                Pesquisar
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
