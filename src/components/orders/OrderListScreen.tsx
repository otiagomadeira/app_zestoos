'use client'

import { useState, useCallback, useEffect } from 'react'
import { fetchActiveOrders, updateOrderStatus, receiveOrder } from '@/lib/supabase'
import type { OrderWithDetails } from '@/lib/supabase'

export default function OrderListScreen() {
  const [orders,     setOrders]     = useState<OrderWithDetails[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [expanded,   setExpanded]   = useState<string | null>(null)
  const [actionId,   setActionId]   = useState<string | null>(null)  // ordem em curso de ação

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setOrders(await fetchActiveOrders())
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao carregar encomendas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSend = async (orderId: string) => {
    setActionId(orderId)
    setError(null)
    try {
      await updateOrderStatus(orderId, 'SENT')
      setOrders(prev => prev.map(o =>
        o.id === orderId ? { ...o, status: 'SENT', sent_at: new Date().toISOString() } : o
      ))
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao enviar encomenda')
    } finally {
      setActionId(null)
    }
  }

  const handleReceive = async (orderId: string) => {
    setActionId(orderId)
    setError(null)
    try {
      await receiveOrder(orderId)
      // Encomenda passa a RECEIVED — remove-a da lista activa
      setOrders(prev => prev.filter(o => o.id !== orderId))
      if (expanded === orderId) setExpanded(null)
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao registar receção')
    } finally {
      setActionId(null)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            border: '3px solid var(--border)', borderTopColor: 'var(--action)',
            animation: 'spin 0.8s linear infinite', margin: '0 auto 16px',
          }} />
          <p style={{ color: 'var(--text-subtle)', fontSize: 14 }}>A carregar encomendas…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  const drafts = orders.filter(o => o.status === 'DRAFT')
  const sent   = orders.filter(o => o.status === 'SENT')

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 16px 40px' }}>

      {/* Header */}
      <div style={{ padding: '20px 0 16px', borderBottom: '1px solid rgba(28,20,10,0.1)', marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Encomendas</h2>
        <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>
          {drafts.length} rascunho{drafts.length !== 1 ? 's' : ''}
          {sent.length > 0 && ` · ${sent.length} enviada${sent.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {error && (
        <div style={{
          background: 'rgba(139,46,46,0.08)', border: '1px solid var(--error)',
          borderRadius: 8, padding: '10px 14px', color: 'var(--error)',
          fontSize: 13, marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {orders.length === 0 && (
        <div style={{
          background: 'rgba(28,20,10,0.04)', border: '1px solid rgba(28,20,10,0.1)',
          borderRadius: 12, padding: '32px 24px', textAlign: 'center',
        }}>
          <p style={{ fontSize: 14, color: 'var(--text-subtle)' }}>Nenhuma encomenda activa.</p>
          <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 6 }}>
            Cria rascunhos na tab Sugestões.
          </p>
        </div>
      )}

      {/* Enviadas primeiro (ação imediata: receber) */}
      {sent.length > 0 && (
        <Section label="Enviadas" accent="var(--success)">
          {sent.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              isExpanded={expanded === order.id}
              isActing={actionId === order.id}
              onToggle={() => setExpanded(prev => prev === order.id ? null : order.id)}
              onSend={handleSend}
              onReceive={handleReceive}
            />
          ))}
        </Section>
      )}

      {/* Rascunhos */}
      {drafts.length > 0 && (
        <Section label="Rascunhos" accent="#A07010">
          {drafts.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              isExpanded={expanded === order.id}
              isActing={actionId === order.id}
              onToggle={() => setExpanded(prev => prev === order.id ? null : order.id)}
              onSend={handleSend}
              onReceive={handleReceive}
            />
          ))}
        </Section>
      )}
    </div>
  )
}

// ── Sub-componentes ────────────────────────────────────────────

function Section({ label, accent, children }: {
  label:    string
  accent:   string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: accent, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-subtle)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {label}
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(28,20,10,0.1)' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  )
}

function OrderCard({ order, isExpanded, isActing, onToggle, onSend, onReceive }: {
  order:      OrderWithDetails
  isExpanded: boolean
  isActing:   boolean
  onToggle:   () => void
  onSend:     (id: string) => void
  onReceive:  (id: string) => void
}) {
  const isDraft  = order.status === 'DRAFT'
  const isSent   = order.status === 'SENT'
  const date     = new Date(order.created_at).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })
  const sentDate = order.sent_at
    ? new Date(order.sent_at).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })
    : null

  return (
    <div style={{
      background:   isExpanded ? 'rgba(196,106,45,0.06)' : 'var(--surface)',
      border:       `1px solid ${isExpanded ? 'var(--action)' : 'var(--border)'}`,
      borderRadius: 12,
      overflow:     'hidden',
      transition:   'all 0.15s',
    }}>
      {/* Header — clicável */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', background: 'transparent', border: 'none',
          padding: '14px 16px', cursor: 'pointer', textAlign: 'left',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
            {order.supplier_name}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
            {order.items.length} artigo{order.items.length !== 1 ? 's' : ''}
            {' · '}criada {date}
            {sentDate && ` · enviada ${sentDate}`}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <StatusBadge status={order.status} />
          <span style={{ fontSize: 16, color: 'var(--text-subtle)', lineHeight: 1 }}>
            {isExpanded ? '▲' : '▼'}
          </span>
        </div>
      </button>

      {/* Expanded */}
      {isExpanded && (
        <div
          style={{ padding: '0 16px 14px', borderTop: '1px solid rgba(28,20,10,0.1)', paddingTop: 12 }}
          onClick={e => e.stopPropagation()}
        >
          {/* Items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {order.items.map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{item.article_name}</span>
                <span style={{ fontSize: 13, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: 'var(--text)' }}>
                  {item.quantity_ordered} {item.order_unit}
                </span>
              </div>
            ))}
          </div>

          {/* Ações */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {isDraft && (
              <button
                onClick={() => onSend(order.id)}
                disabled={isActing}
                style={actionBtn('var(--success)', isActing)}
              >
                {isActing ? '…' : 'Marcar como Enviada'}
              </button>
            )}
            {isSent && (
              <button
                onClick={() => onReceive(order.id)}
                disabled={isActing}
                style={actionBtn('var(--action)', isActing)}
              >
                {isActing ? 'A registar…' : 'Registar Receção'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: OrderWithDetails['status'] }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    DRAFT:  { label: 'Rascunho', bg: 'rgba(184,134,11,0.1)',  color: '#A07010' },
    SENT:   { label: 'Enviada',  bg: 'rgba(85,107,71,0.12)',  color: 'var(--success)' },
  }
  const s = map[status] ?? { label: status, bg: 'rgba(28,20,10,0.08)', color: 'var(--text-subtle)' }
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
      padding: '3px 7px', borderRadius: 5,
      background: s.bg, color: s.color,
    }}>
      {s.label.toUpperCase()}
    </span>
  )
}

function actionBtn(bg: string, disabled: boolean): React.CSSProperties {
  return {
    height: 38, padding: '0 16px', borderRadius: 8,
    border: 'none', background: disabled ? 'rgba(28,20,10,0.1)' : bg,
    color: disabled ? 'var(--text-subtle)' : '#FFFFFF',
    fontSize: 13, fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
  }
}
