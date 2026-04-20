'use client'

import { useState } from 'react'
import OrderSuggestionScreen from '@/components/orders/OrderSuggestionScreen'
import OrderListScreen       from '@/components/orders/OrderListScreen'

type Tab = 'sugestoes' | 'encomendas'

export default function EncomendasPage() {
  const [tab, setTab] = useState<Tab>('sugestoes')

  return (
    <div style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>

      {/* Tab bar */}
      <div style={{
        display:       'flex',
        borderBottom:  '1px solid rgba(28,20,10,0.1)',
        background:    'var(--bg)',
        flexShrink:    0,
        padding:       '0 16px',
      }}>
        {(['sugestoes', 'encomendas'] as Tab[]).map(t => {
          const labels: Record<Tab, string> = { sugestoes: 'Sugestões', encomendas: 'Encomendas' }
          const isActive = tab === t
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                height:        44,
                padding:       '0 16px',
                background:    'transparent',
                border:        'none',
                borderBottom:  isActive ? '2px solid var(--action)' : '2px solid transparent',
                color:         isActive ? 'var(--action)' : 'var(--text-subtle)',
                fontSize:      14,
                fontWeight:    isActive ? 600 : 400,
                cursor:        'pointer',
                transition:    'all 0.15s',
                marginBottom:  -1,
              }}
            >
              {labels[t]}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'sugestoes'  && <OrderSuggestionScreen />}
        {tab === 'encomendas' && <OrderListScreen />}
      </div>
    </div>
  )
}
