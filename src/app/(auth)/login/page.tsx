'use client'

import { useState } from 'react'
import Link from 'next/link'
import { signIn } from '../actions'

const inputStyle: React.CSSProperties = {
  width:        '100%',
  height:       48,
  background:   '#FFFFFF',
  border:       '1px solid rgba(28,20,10,0.18)',
  borderRadius: 10,
  padding:      '0 16px',
  color:        'var(--text)',
  fontSize:     15,
  outline:      'none',
}

export default function LoginPage() {
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const result = await signIn(new FormData(e.currentTarget))
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div style={{ width: '100%', maxWidth: 400 }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32, justifyContent: 'center' }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 22, height: 22, borderRadius: 4, background: 'var(--action)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L14 5V11L8 14L2 11V5L8 2Z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
              <circle cx="8" cy="8" r="2" fill="white"/>
            </svg>
          </div>
        </div>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 16, fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.05em' }}>
          ZESTO OS
        </span>
      </div>

      {/* Card */}
      <div style={{ background: '#FFFFFF', borderRadius: 16, padding: '32px 28px', boxShadow: '0 4px 24px rgba(28,20,10,0.08)' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
          Entrar
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-subtle)', marginBottom: 28 }}>
          Acede à tua cozinha
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.04em' }}>
              EMAIL
            </label>
            <input
              type="email"
              name="email"
              placeholder="chef@restaurante.pt"
              required
              autoComplete="email"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.04em' }}>
              PASSWORD
            </label>
            <input
              type="password"
              name="password"
              placeholder="••••••••"
              required
              autoComplete="current-password"
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{ background: 'rgba(139,46,46,0.08)', border: '1px solid rgba(139,46,46,0.3)', borderRadius: 8, padding: '10px 14px', color: 'var(--error)', fontSize: 13 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width:        '100%',
              height:       52,
              borderRadius: 12,
              border:       'none',
              background:   'var(--action)',
              color:        '#FFFFFF',
              fontSize:     16,
              fontWeight:   600,
              cursor:       loading ? 'default' : 'pointer',
              opacity:      loading ? 0.7 : 1,
              marginTop:    4,
              letterSpacing: '0.02em',
            }}
          >
            {loading ? 'A entrar…' : 'Entrar'}
          </button>
        </form>
      </div>

      <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: 'var(--text-subtle)' }}>
        Ainda não tens conta?{' '}
        <Link href="/register" style={{ color: 'var(--action)', fontWeight: 600, textDecoration: 'none' }}>
          Registar restaurante
        </Link>
      </p>
    </div>
  )
}
