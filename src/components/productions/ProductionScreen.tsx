'use client'

import { useState, useCallback, useEffect } from 'react'
import type {
  CurrentProductionStock,
  Production,
  ProductionDetail,
  ProductionWithCost,
} from '@/types/database'
import {
  fetchProductionsWithStock,
  fetchProductionDetail,
  saveProductionCount,
} from '@/lib/supabase'
import { useIsMobile } from '@/hooks/useIsMobile'
import ProductionCard from './ProductionCard'
import ProductionDetailPanel from './ProductionDetail'
import ProductionForm from './ProductionForm'
import NumericKeypad from '@/components/ui/NumericKeypad'

type RightPanelMode = 'detail' | 'count' | 'form'
type MobileView     = 'list' | 'detail' | 'count' | 'form'
type ProductionListItem = CurrentProductionStock & Partial<ProductionWithCost>

export default function ProductionScreen() {
  const isMobile = useIsMobile()

  const [items,         setItems]         = useState<ProductionListItem[]>([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)
  const [selectedId,    setSelectedId]    = useState<string | null>(null)
  const [detail,        setDetail]        = useState<ProductionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [mode,          setMode]          = useState<RightPanelMode>('detail')
  const [mobileView,    setMobileView]    = useState<MobileView>('list')
  const [countValue,    setCountValue]    = useState('0')
  const [saving,        setSaving]        = useState(false)
  const [saveSuccess,   setSaveSuccess]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchProductionsWithStock()
      setItems(data)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao carregar produções')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    setDetail(null)
    try {
      const d = await fetchProductionDetail(id)
      setDetail(d)
      setCountValue(String(d.current_qty ?? '0'))
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao carregar detalhe')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const handleSelect = (id: string) => {
    setSelectedId(id)
    setMode('detail')
    loadDetail(id)
    if (isMobile) setMobileView('detail')
  }

  const handleConfirmCount = async () => {
    if (!selectedId || !detail) return
    const qty = parseFloat(countValue)
    if (isNaN(qty)) return

    setSaving(true)
    try {
      await saveProductionCount(selectedId, qty, detail.yield_unit)
      setItems(prev => prev.map(i =>
        i.production_id === selectedId ? { ...i, current_qty: qty } : i
      ))
      setDetail(prev => prev ? { ...prev, current_qty: qty } : prev)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
      setMode('detail')
      if (isMobile) setMobileView('detail')
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleSaved = (prod: Production) => {
    load()
    setSelectedId(prod.id)
    setMode('detail')
    loadDetail(prod.id)
    if (isMobile) setMobileView('detail')
  }

  const openForm = (editMode = false) => {
    if (!editMode) { setSelectedId(null); setDetail(null) }
    setMode('form')
    if (isMobile) setMobileView('form')
  }

  const selected = items.find(i => i.production_id === selectedId)

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
          <p style={{ color: 'var(--text-subtle)', fontSize: 14 }}>A carregar produções…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // ── MOBILE ────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

        {/* Lista */}
        {mobileView === 'list' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Fichas Técnicas</h2>
                  <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 1 }}>{items.length} produção{items.length !== 1 ? 'ões' : ''}</p>
                </div>
                <button
                  onClick={() => openForm(false)}
                  style={{ height: 44, padding: '0 14px', borderRadius: 8, border: '1px solid var(--action-border)', background: 'var(--action-surface)', color: 'var(--action)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  + Nova
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {error && <div style={{ background: 'var(--error-surface)', border: `1px solid var(--error-border)`, borderRadius: 8, padding: '10px 14px', color: 'var(--error)', fontSize: 13 }}>{error}</div>}
              {items.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-subtle)', paddingTop: 40 }}>
                  <p style={{ fontSize: 28, marginBottom: 12 }}>🍳</p>
                  <p>Sem fichas técnicas.</p>
                </div>
              )}
              {items.map(item => (
                <ProductionCard
                  key={item.production_id}
                  production={item}
                  isSelected={selectedId === item.production_id}
                  onClick={() => handleSelect(item.production_id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Detalhe */}
        {mobileView === 'detail' && (
          <div style={{ flex: 1, background: 'var(--primary)', padding: '16px 20px', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            <button onClick={() => setMobileView('list')} style={{ background: 'none', border: 'none', color: 'var(--text-on-primary-muted)', fontSize: 14, cursor: 'pointer', padding: 0, marginBottom: 16, textAlign: 'left' }}>
              ← Fichas
            </button>
            {detailLoading && (
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', border: `2px solid var(--border-on-primary)`, borderTopColor: 'var(--action)', animation: 'spin 0.8s linear infinite' }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}
            {!detailLoading && detail && (
              <ProductionDetailPanel
                production={detail}
                onCount={() => { setCountValue(String(detail.current_qty ?? '0')); setMobileView('count') }}
                onEdit={() => setMobileView('form')}
              />
            )}
          </div>
        )}

        {/* Contagem */}
        {mobileView === 'count' && selected && (
          <div style={{ flex: 1, background: 'var(--primary)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
            <button onClick={() => setMobileView('detail')} style={{ background: 'none', border: 'none', color: 'var(--text-on-primary-muted)', fontSize: 14, cursor: 'pointer', padding: 0, textAlign: 'left' }}>
              ← Detalhe
            </button>
            <div>
              <p style={{ fontSize: 11, color: 'var(--text-on-primary-subtle)', letterSpacing: '0.08em', marginBottom: 4 }}>A CONTAR</p>
              <h3 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-on-primary)' }}>{selected.name}</h3>
            </div>
            {saveSuccess && (
              <div style={{ background: 'var(--success-surface-on-primary)', border: `1px solid var(--success-border-on-primary)`, borderRadius: 8, padding: '10px 14px', color: 'var(--success-on-primary)', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
                ✓ Contagem guardada
              </div>
            )}
            <NumericKeypad value={countValue} onChange={setCountValue} onConfirm={saving ? undefined : handleConfirmCount} unit={selected.unit} />
            {saving && <p style={{ textAlign: 'center', color: 'var(--text-on-primary-subtle)', fontSize: 13 }}>A guardar…</p>}
          </div>
        )}

        {/* Formulário */}
        {mobileView === 'form' && (
          <div style={{ flex: 1, background: 'var(--primary)', padding: '16px 20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <ProductionForm
              existing={detail && selectedId ? detail : undefined}
              onSaved={handleSaved}
              onCancel={() => setMobileView(selectedId ? 'detail' : 'list')}
            />
          </div>
        )}
      </div>
    )
  }

  // ── DESKTOP ───────────────────────────────────────────────────
  return (
    <div style={{
      display:             'grid',
      gridTemplateColumns: 'minmax(0, 1fr) 360px',
      height:              '100%',
      overflow:            'hidden',
    }}>
      {/* Painel esquerdo */}
      <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--bg)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Fichas Técnicas</h2>
              <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{items.length} produção{items.length !== 1 ? 'ões' : ''}</p>
            </div>
            <button
              onClick={() => openForm(false)}
              style={{ height: 44, padding: '0 14px', borderRadius: 8, border: '1px solid var(--action-border)', background: 'var(--action-surface)', color: 'var(--action)', fontSize: 13, fontWeight: 600, cursor: 'pointer', letterSpacing: '0.02em' }}
            >
              + Nova Ficha
            </button>
          </div>
        </div>

        {error && (
          <div style={{ margin: '12px 16px 0', background: 'var(--error-surface)', border: `1px solid var(--error-border)`, borderRadius: 8, padding: '10px 14px', color: 'var(--error)', fontSize: 13 }}>
            {error}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-subtle)', paddingTop: 40, fontSize: 14 }}>
              <p style={{ fontSize: 28, marginBottom: 12 }}>🍳</p>
              <p>Sem fichas técnicas.</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>Clica em &quot;+ Nova Ficha&quot; para começar.</p>
            </div>
          )}
          {items.map(item => (
            <ProductionCard
              key={item.production_id}
              production={item}
              isSelected={selectedId === item.production_id}
              onClick={() => handleSelect(item.production_id)}
            />
          ))}
        </div>
      </div>

      {/* Painel direito */}
      <div style={{ background: 'var(--primary)', padding: 24, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

        {mode === 'form' && (
          <ProductionForm
            existing={detail && selectedId ? detail : undefined}
            onSaved={handleSaved}
            onCancel={() => setMode(selectedId ? 'detail' : 'detail')}
          />
        )}

        {mode === 'detail' && (
          <>
            {detailLoading && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', border: `2px solid var(--border-on-primary)`, borderTopColor: 'var(--action)', animation: 'spin 0.8s linear infinite' }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}
            {!detailLoading && detail && (
              <ProductionDetailPanel
                production={detail}
                onCount={() => { setCountValue(String(detail.current_qty ?? '0')); setMode('count') }}
                onEdit={() => setMode('form')}
              />
            )}
            {!detailLoading && !detail && !selectedId && (
              <div style={{ textAlign: 'center', color: 'var(--text-on-primary-faint)', margin: 'auto' }}>
                <p style={{ fontSize: 32, marginBottom: 12 }}>←</p>
                <p style={{ fontSize: 14 }}>Seleciona uma ficha técnica</p>
                <p style={{ fontSize: 12, marginTop: 4 }}>ou cria uma nova</p>
              </div>
            )}
          </>
        )}

        {mode === 'count' && selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <button onClick={() => setMode('detail')} style={{ background: 'none', border: 'none', color: 'var(--text-on-primary-muted)', fontSize: 13, cursor: 'pointer', padding: 0, textAlign: 'left' }}>
              ← Voltar ao detalhe
            </button>
            <div>
              <p style={{ fontSize: 11, color: 'var(--text-on-primary-subtle)', letterSpacing: '0.08em', marginBottom: 4 }}>A CONTAR</p>
              <h3 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-on-primary)', lineHeight: 1.2 }}>{selected.name}</h3>
              <p style={{ fontSize: 12, color: 'var(--text-on-primary-subtle)', marginTop: 4 }}>
                Unidade: <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-on-primary)' }}>{selected.unit}</span>
              </p>
            </div>
            {saveSuccess && (
              <div style={{ background: 'var(--success-surface-on-primary)', border: `1px solid var(--success-border-on-primary)`, borderRadius: 8, padding: '10px 14px', color: 'var(--success-on-primary)', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
                ✓ Contagem guardada
              </div>
            )}
            <NumericKeypad value={countValue} onChange={setCountValue} onConfirm={saving ? undefined : handleConfirmCount} unit={selected.unit} />
            {saving && <p style={{ textAlign: 'center', color: 'var(--text-on-primary-subtle)', fontSize: 13 }}>A guardar…</p>}
          </div>
        )}
      </div>
    </div>
  )
}
