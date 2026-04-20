'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const NAV_ITEMS = [
  { href: '/',             label: 'Inventário',   icon: IconInventory   },
  { href: '/encomendas',   label: 'Encomendas',   icon: IconOrders      },
  { href: '/producoes',    label: 'Produções',    icon: IconProductions },
  { href: '/artigos',      label: 'Artigos',      icon: IconArticles    },
  { href: '/fornecedores', label: 'Fornecedores', icon: IconSuppliers   },
]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
      {/* ── Top bar ─────────────────────────────────────────── */}
      <header style={{
        height:         64,
        background:     'var(--primary)',
        borderBottom:   'none',
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
            background:   'var(--action)',
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
            color:         'var(--text-on-primary)',
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
                  background:     active ? 'rgba(196,106,45,0.2)' : 'transparent',
                  color:          active ? 'var(--action)' : 'rgba(242,233,220,0.6)',
                  fontSize:       13,
                  fontWeight:     active ? 600 : 400,
                  textDecoration: 'none',
                  transition:     'all 0.15s',
                  border:         active ? '1px solid rgba(196,106,45,0.4)' : '1px solid transparent',
                }}
              >
                <item.icon size={15} />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Spacer + date + logout */}
        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'rgba(242,233,220,0.35)' }}>
          {new Date().toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}
        </div>
        <button
          onClick={handleSignOut}
          style={{
            height:        30,
            padding:       '0 12px',
            borderRadius:  6,
            border:        '1px solid rgba(242,233,220,0.15)',
            background:    'transparent',
            color:         'rgba(242,233,220,0.5)',
            fontSize:      12,
            cursor:        'pointer',
            letterSpacing: '0.04em',
          }}
        >
          Sair
        </button>
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

function IconProductions({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M8 2C5.8 2 4 3.8 4 6C4 7.5 4.8 8.8 6 9.5V12H10V9.5C11.2 8.8 12 7.5 12 6C12 3.8 10.2 2 8 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M6 13H10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function IconArticles({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M5 5.5H11M5 8H9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

function IconSuppliers({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M1.5 13C1.5 10.5 3.5 9 6 9C8.5 9 10.5 10.5 10.5 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M11 7.5C12.4 7.5 13.5 8.6 13.5 10V13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="11" cy="5.5" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}
