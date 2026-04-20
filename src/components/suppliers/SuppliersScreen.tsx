'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Supplier } from '@/types/database'
import { fetchAllSuppliers } from '@/lib/supabase'
import { useIsMobile } from '@/hooks/useIsMobile'
import SupplierForm from './SupplierForm'

type Mode = 'idle' | 'create' | 'edit'

export default function SuppliersScreen() {
  const isMobile = useIsMobile()

  const [suppliers,    setSuppliers]    = useState<Supplier[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [search,       setSearch]       = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [mode,         setMode]         = useState<Mode>('idle')
  const [selected,     setSelected]     = useState<Supplier | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSuppliers(await fetchAllSuppliers())
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao carregar fornecedores')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() =>
    suppliers.filter(s =>
      (showInactive || s.is_active) &&
      s.name.toLowerCase().includes(search.toLowerCase())
    ),
    [suppliers, search, showInactive]
  )

  const handleSaved = (supplier: Supplier) => {
    setSuppliers(prev => {
      const idx = prev.findIndex(s => s.id === supplier.id)
      return idx >= 0
        ? prev.map(s => s.id === supplier.id ? supplier : s)
        : [supplier, ...prev]
    })
    setSelected(supplier)
    setMode('edit')
  }

  const handleSelect = (s: Supplier) => {
    setSelected(s)
    setMode('edit')
  }

  const handleNew = () => {
    setSelected(null)
    setMode('create')
  }

  const handleCancel = () => {
    setMode('idle')
    setSelected(null)
  }

  const showPanel = mode !== 'idle'
  const showList  = !isMobile || !showPanel

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--action)', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <p style={{ color: 'var(--text-subtle)', fontSize: 14 }}>A carregar fornecedores…</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  // ── List panel ─────────────────────────────────────────────────────────────
  const listPanel = (
    <div style={{
      display:       'flex',
      flexDirection: 'column',
      borderRight:   '1px solid rgba(28,20,10,0.1)',
      background:    'var(--bg)',
      height:        '100%',
      overflow:      'hidden',
    }}>
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid rgba(28,20,10,0.1)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Fornecedores</h2>
          <button
            onClick={handleNew}
            style={{ height: 34, padding: '0 14px', borderRadius: 8, border: 'none', background: 'var(--action)', color: '#FFF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            + Novo
          </button>
        </div>
        <input
          type="text"
          placeholder="Pesquisar…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', height: 36, background: 'var(--surface)', border: '1px solid rgba(28,20,10,0.15)', borderRadius: 8, padding: '0 12px', color: 'var(--text)', fontSize: 14, outline: 'none' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--text-subtle)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Mostrar inativos
        </label>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {error && (
          <div style={{ background: 'rgba(139,46,46,0.08)', border: '1px solid var(--error)', borderRadius: 8, padding: '10px 14px', color: 'var(--error)', fontSize: 13, marginBottom: 8 }}>
            {error}
          </div>
        )}
        {filtered.length === 0 && (
          <p style={{ color: 'var(--text-subtle)', fontSize: 14, textAlign: 'center', paddingTop: 32 }}>
            Nenhum fornecedor encontrado
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(s => (
            <button
              key={s.id}
              onClick={() => handleSelect(s)}
              style={{
                width:        '100%',
                textAlign:    'left',
                padding:      '12px 14px',
                borderRadius: 10,
                border:       `1px solid ${selected?.id === s.id ? 'var(--action)' : 'var(--border)'}`,
                background:   selected?.id === s.id ? 'rgba(196,106,45,0.06)' : 'var(--surface)',
                cursor:       'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: s.is_active ? 'var(--text)' : 'var(--text-subtle)' }}>
                  {s.name}
                </span>
                {!s.is_active && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)', background: 'rgba(28,20,10,0.06)', padding: '2px 6px', borderRadius: 4, letterSpacing: '0.05em' }}>
                    INATIVO
                  </span>
                )}
              </div>
              {s.phone && <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{s.phone}</p>}
              {!s.phone && s.email && <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{s.email}</p>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  // ── Right panel ────────────────────────────────────────────────────────────
  const rightPanel = (
    <div style={{ background: 'var(--primary)', padding: '24px 20px', display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
      {showPanel ? (
        <SupplierForm
          existing={mode === 'edit' ? selected ?? undefined : undefined}
          onSaved={handleSaved}
          onCancel={handleCancel}
        />
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: 'rgba(242,233,220,0.3)', fontSize: 14 }}>Seleciona ou cria um fornecedor</p>
        </div>
      )}
    </div>
  )

  // ── Mobile ─────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ height: 'calc(100vh - 64px)', background: 'var(--bg)' }}>
        {showList  && listPanel}
        {showPanel && rightPanel}
      </div>
    )
  }

  // ── Desktop: list is the main area, right panel is the supporting sidebar ──
  return (
    <div style={{
      display:             'grid',
      gridTemplateColumns: 'minmax(0, 1fr) 420px',
      height:              'calc(100vh - 64px)',
      overflow:            'hidden',
    }}>
      {listPanel}
      {rightPanel}
    </div>
  )
}
