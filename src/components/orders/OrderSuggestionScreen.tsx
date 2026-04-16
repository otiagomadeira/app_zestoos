'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import type { OrderSuggestion } from '@/types/database'
import { fetchOrderSuggestions, supabase } from '@/lib/supabase'

type SelectedItems = Record<string, number> // articleId → qty to order (in order_unit)

export default function OrderSuggestionScreen() {
  const [suggestions, setSuggestions] = useState<OrderSuggestion[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [selected, setSelected]       = useState<SelectedItems>({})
  const [creating, setCreating]       = useState(false)
  const [success, setSuccess]         = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchOrderSuggestions()
      setSuggestions(data)
      // Pre-select all with suggested qty
      const init: SelectedItems = {}
      data.forEach(s => {
        if (s.order_qty_in_order_unit && s.order_qty_in_order_unit > 0) {
          init[s.article_id] = s.order_qty_in_order_unit
        }
      })
      setSelected(init)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao carregar sugestões')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Group by supplier
  const bySupplier = useMemo(() => {
    const map = new Map<string, { name: string; items: OrderSuggestion[] }>()
    suggestions.forEach(s => {
      const key  = s.supplier_id ?? '__no_supplier__'
      const name = s.supplier_name ?? 'Sem fornecedor'
      if (!map.has(key)) map.set(key, { name, items: [] })
      map.get(key)!.items.push(s)
    })
    return map
  }, [suggestions])

  const selectedCount = Object.keys(selected).length

  // Compute total value for selected items
  const totalValue = useMemo(() => {
    return suggestions.reduce((sum, s) => {
      const qty = selected[s.article_id]
      if (qty && s.price) return sum + qty * s.price
      return sum
    }, 0)
  }, [suggestions, selected])

  const toggleItem = (articleId: string, defaultQty: number) => {
    setSelected(prev => {
      const next = { ...prev }
      if (next[articleId] !== undefined) {
        delete next[articleId]
      } else {
        next[articleId] = defaultQty
      }
      return next
    })
  }

  const updateQty = (articleId: string, delta: number) => {
    setSelected(prev => {
      const cur = prev[articleId] ?? 0
      const next = Math.max(1, cur + delta)
      return { ...prev, [articleId]: next }
    })
  }

  // ── Create DRAFT orders grouped by supplier ────────────────
  const handleCreateOrders = async () => {
    if (selectedCount === 0) return
    setCreating(true)
    setError(null)

    try {
      // Group selected items by supplier
      const supplierGroups = new Map<string, { supplierId: string; items: Array<{ articleId: string; qty: number; orderUnit: string }> }>()

      suggestions.forEach(s => {
        const qty = selected[s.article_id]
        if (qty === undefined || !s.supplier_id) return

        const key = s.supplier_id
        if (!supplierGroups.has(key)) {
          supplierGroups.set(key, { supplierId: s.supplier_id, items: [] })
        }
        supplierGroups.get(key)!.items.push({
          articleId: s.article_id,
          qty,
          orderUnit: s.order_unit ?? s.unit,
        })
      })

      let ordersCreated = 0

      for (const [, group] of supplierGroups) {
        // Create order
        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .insert({ supplier_id: group.supplierId, status: 'DRAFT' })
          .select()
          .single()

        if (orderErr) throw orderErr

        // Create order items
        const items = group.items.map(i => ({
          order_id:         order.id,
          article_id:       i.articleId,
          quantity_ordered: i.qty,
          order_unit:       i.orderUnit,
        }))

        const { error: itemsErr } = await supabase
          .from('order_items')
          .insert(items)

        if (itemsErr) throw itemsErr

        ordersCreated++
      }

      setSuccess(`${ordersCreated} encomenda${ordersCreated !== 1 ? 's' : ''} criada${ordersCreated !== 1 ? 's' : ''} em rascunho`)
      setSelected({})
      setTimeout(() => { setSuccess(null); load() }, 3000)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao criar encomendas')
    } finally {
      setCreating(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            border: '3px solid #2A2A2A', borderTopColor: '#FF5F1F',
            animation: 'spin 0.8s linear infinite', margin: '0 auto 16px',
          }} />
          <p style={{ color: '#555555', fontSize: 14 }}>A calcular sugestões…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 16px 120px' }}>

      {/* Header */}
      <div style={{ padding: '20px 0 16px', borderBottom: '1px solid #1C1C1C', marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#F5F5F5' }}>
          Sugestão de Encomenda
        </h2>
        <p style={{ fontSize: 12, color: '#555555', marginTop: 4 }}>
          {suggestions.length} artigo{suggestions.length !== 1 ? 's' : ''} abaixo do par level
        </p>
      </div>

      {/* Banners */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.1)', border: '1px solid #EF4444',
          borderRadius: 8, padding: '12px 16px', color: '#EF4444',
          fontSize: 13, marginBottom: 16,
        }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{
          background: 'rgba(34,197,94,0.1)', border: '1px solid #22C55E',
          borderRadius: 8, padding: '12px 16px', color: '#22C55E',
          fontSize: 13, fontWeight: 600, marginBottom: 16, textAlign: 'center',
        }}>
          ✓ {success}
        </div>
      )}

      {suggestions.length === 0 && !loading && (
        <div style={{
          background: 'rgba(34,197,94,0.06)', border: '1px solid #1C4A29',
          borderRadius: 12, padding: '32px 24px', textAlign: 'center',
        }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>✓</p>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#22C55E' }}>
            Tudo em stock!
          </p>
          <p style={{ fontSize: 13, color: '#555555', marginTop: 8 }}>
            Nenhum artigo abaixo do par level.
          </p>
        </div>
      )}

      {/* Items grouped by supplier */}
      {Array.from(bySupplier.entries()).map(([supplierId, group]) => (
        <div key={supplierId} style={{ marginBottom: 24 }}>
          {/* Supplier header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            marginBottom: 10,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: '#FF5F1F', flexShrink: 0,
            }} />
            <span style={{
              fontSize: 12, fontWeight: 600, color: '#9A9A9A',
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              {group.name}
            </span>
            <div style={{ flex: 1, height: 1, background: '#1C1C1C' }} />
          </div>

          {/* Items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {group.items.map(s => {
              const isSelected = selected[s.article_id] !== undefined
              const qty        = selected[s.article_id] ?? s.order_qty_in_order_unit ?? 0
              const lineTotal  = s.price ? qty * s.price : null

              return (
                <div
                  key={s.article_id}
                  style={{
                    background:   isSelected ? 'rgba(255,95,31,0.06)' : '#141414',
                    border:       `1px solid ${isSelected ? '#FF5F1F' : '#2A2A2A'}`,
                    borderRadius: 12,
                    padding:      '14px 16px',
                    transition:   'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    {/* Checkbox + info */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1, minWidth: 0 }}>
                      <button
                        onClick={() => toggleItem(s.article_id, s.order_qty_in_order_unit ?? 1)}
                        style={{
                          width:          24,
                          height:         24,
                          minWidth:       24,
                          borderRadius:   6,
                          border:         `2px solid ${isSelected ? '#FF5F1F' : '#2A2A2A'}`,
                          background:     isSelected ? '#FF5F1F' : 'transparent',
                          cursor:         'pointer',
                          display:        'flex',
                          alignItems:     'center',
                          justifyContent: 'center',
                          flexShrink:     0,
                          marginTop:      2,
                        }}
                      >
                        {isSelected && (
                          <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                            <path d="M1 5L4.5 8.5L11 1.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </button>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 15, fontWeight: 600, color: '#F5F5F5' }}>{s.name}</p>
                        <div style={{ display: 'flex', gap: 16, marginTop: 4, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, color: '#555555' }}>
                            Stock:{' '}
                            <span style={{
                              fontFamily: 'JetBrains Mono, monospace',
                              color: s.current_qty <= 0 ? '#EF4444' : '#F59E0B',
                            }}>
                              {s.current_qty.toFixed(s.current_qty % 1 === 0 ? 0 : 1)} {s.unit}
                            </span>
                          </span>
                          <span style={{ fontSize: 11, color: '#555555' }}>
                            Par:{' '}
                            <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9A9A9A' }}>
                              {s.par_level} {s.unit}
                            </span>
                          </span>
                          {s.price && (
                            <span style={{ fontSize: 11, color: '#555555' }}>
                              Preço:{' '}
                              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9A9A9A' }}>
                                {s.price.toFixed(2)}€/{s.order_unit}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Qty stepper */}
                    <div style={{
                      display:        'flex',
                      flexDirection:  'column',
                      alignItems:     'flex-end',
                      gap:            6,
                      flexShrink:     0,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          onClick={() => updateQty(s.article_id, -1)}
                          disabled={!isSelected}
                          style={{
                            width: 32, height: 32, minHeight: 44,
                            borderRadius: 6, border: '1px solid #2A2A2A',
                            background: '#1C1C1C', color: '#9A9A9A',
                            cursor: isSelected ? 'pointer' : 'default',
                            opacity: isSelected ? 1 : 0.3,
                            fontSize: 18, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                          }}
                        >−</button>

                        <span style={{
                          fontFamily:  'JetBrains Mono, monospace',
                          fontSize:    18,
                          fontWeight:  700,
                          color:       isSelected ? '#F5F5F5' : '#555555',
                          minWidth:    40,
                          textAlign:   'center',
                        }}>
                          {qty}
                        </span>

                        <button
                          onClick={() => updateQty(s.article_id, +1)}
                          disabled={!isSelected}
                          style={{
                            width: 32, height: 32, minHeight: 44,
                            borderRadius: 6, border: '1px solid #2A2A2A',
                            background: '#1C1C1C', color: '#9A9A9A',
                            cursor: isSelected ? 'pointer' : 'default',
                            opacity: isSelected ? 1 : 0.3,
                            fontSize: 18, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                          }}
                        >+</button>
                      </div>

                      <span style={{
                        fontSize:   10,
                        color:      '#555555',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}>
                        {s.order_unit ?? s.unit}
                        {lineTotal !== null && isSelected && (
                          <span style={{ color: '#9A9A9A' }}>
                            {' '}· {lineTotal.toFixed(2)}€
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* ── Floating action bar ───────────────────────────────── */}
      {suggestions.length > 0 && (
        <div style={{
          position:       'fixed',
          bottom:         0,
          left:           0,
          right:          0,
          background:     'rgba(10,10,10,0.95)',
          backdropFilter: 'blur(12px)',
          borderTop:      '1px solid #1C1C1C',
          padding:        '16px 20px',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          gap:            16,
          zIndex:         100,
        }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#F5F5F5' }}>
              {selectedCount} artigo{selectedCount !== 1 ? 's' : ''} selecionado{selectedCount !== 1 ? 's' : ''}
            </p>
            {totalValue > 0 && (
              <p style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize:   16,
                fontWeight: 700,
                color:      '#FF5F1F',
                marginTop:  2,
              }}>
                {totalValue.toFixed(2)} €
              </p>
            )}
          </div>

          <button
            onClick={handleCreateOrders}
            disabled={selectedCount === 0 || creating}
            style={{
              height:         48,
              minHeight:      44,
              padding:        '0 24px',
              borderRadius:   10,
              border:         'none',
              background:     selectedCount === 0 ? '#1C1C1C' : '#FF5F1F',
              color:          selectedCount === 0 ? '#555555' : '#FFFFFF',
              fontFamily:     'Inter, sans-serif',
              fontSize:       15,
              fontWeight:     600,
              cursor:         selectedCount === 0 ? 'default' : 'pointer',
              transition:     'all 0.15s',
              letterSpacing:  '0.02em',
              opacity:        creating ? 0.7 : 1,
            }}
          >
            {creating ? 'A criar…' : `Criar Rascunho${selectedCount > 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  )
}
