'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/',          label: 'Inventário',  icon: IconInventory  },
  { href: '/encomendas', label: 'Encomendas', icon: IconOrders     },
]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0A0A0A' }}>
      {/* ── Top bar ─────────────────────────────────────────── */}
      <header style={{
        height:         64,
        background:     '#0F0F0F',
        borderBottom:   '1px solid #1C1C1C',
        display:        'flex',
        alignItems:     'center',
        padding:        '0 20px',
        flexShrink:     0,
        gap:            24,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{
            width:        28,
            height:       28,
            borderRadius: 6,
            background:   '#FF5F1F',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L14 5V11L8 14L2 11V5L8 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
              <circle cx="8" cy="8" r="2" fill="white"/>
            </svg>
          </div>
          <span style={{
            fontFamily:    'JetBrains Mono, monospace',
            fontSize:      14,
            fontWeight:    700,
            color:         '#F5F5F5',
            letterSpacing: '0.05em',
          }}>
            ZESTO OS
          </span>
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', gap: 4 }}>
          {NAV_ITEMS.map(item => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display:        'flex',
                  alignItems:     'center',
                  gap:            6,
                  height:         36,
                  padding:        '0 14px',
                  borderRadius:   8,
                  background:     active ? 'rgba(255,95,31,0.12)' : 'transparent',
                  color:          active ? '#FF5F1F' : '#9A9A9A',
                  fontSize:       13,
                  fontWeight:     active ? 600 : 400,
                  textDecoration: 'none',
                  transition:     'all 0.15s',
                  border:         active ? '1px solid rgba(255,95,31,0.3)' : '1px solid transparent',
                }}
              >
                <item.icon size={15} />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Spacer + status */}
        <div style={{ flex: 1 }} />
        <div style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize:   11,
          color:      '#555555',
        }}>
          {new Date().toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}
        </div>
      </header>

      {/* ── Content ──────────────────────────────────────────── */}
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {children}
      </main>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────

function IconInventory({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="1" y="3" width="14" height="2.5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="1" y="6.75" width="14" height="2.5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
      <rect x="1" y="10.5" width="14" height="2.5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}

function IconOrders({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M3 2H13C13.6 2 14 2.4 14 3V13C14 13.6 13.6 14 13 14H3C2.4 14 2 13.6 2 13V3C2 2.4 2.4 2 3 2Z" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M5 5.5H11M5 8H9M5 10.5H10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}
