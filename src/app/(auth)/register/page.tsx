'use client'

import { useState } from 'react'
import Link from 'next/link'
import { signUp } from '../actions'

const inputStyle: React.CSSProperties = {
  width:        '100%',
  height:       48,
  background:   'var(--white)',
  border:       '1px solid var(--border)',
  borderRadius: 10,
  padding:      '0 16px',
  color:        'var(--text)',
  fontSize:     15,
  outline:      'none',
}

export default function RegisterPage() {
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [email,   setEmail]   = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const formData = new FormData(e.currentTarget)
    setEmail(String(formData.get('email')))
    const result = await signUp(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    } else {
      setSuccess(true)
    }
  }

  if (success) {
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

        <div style={{ background: 'var(--white)', borderRadius: 16, padding: '32px 28px', boxShadow: '0 4px 24px rgba(28,20,10,0.08)', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--primary-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M22 6C22 4.9 21.1 4 20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6ZM20 6L12 13L4 6H20ZM20 18H4V8L12 15L20 8V18Z" fill="var(--primary)"/>
            </svg>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
            Confirma o teu email
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 8 }}>
            Enviámos um email de confirmação para
          </p>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--primary)', marginBottom: 20 }}>
            {email}
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-subtle)', lineHeight: 1.6 }}>
            Clica no link no email para ativar a conta e aceder ao Zesto OS.
          </p>
        </div>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: 'var(--text-subtle)' }}>
          Já confirmaste?{' '}
          <Link href="/login" style={{ color: 'var(--action)', fontWeight: 600, textDecoration: 'none' }}>
            Entrar
          </Link>
        </p>
      </div>
    )
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
      <div style={{ background: 'var(--white)', borderRadius: 16, padding: '32px 28px', boxShadow: '0 4px 24px rgba(28,20,10,0.08)' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
          Registar restaurante
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-subtle)', marginBottom: 28 }}>
          Cria a tua conta e começa a gerir a cozinha
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.04em' }}>
              NOME DO RESTAURANTE
            </label>
            <input
              type="text"
              name="restaurant_name"
              placeholder="ex: Zazzaro"
              required
              style={inputStyle}
            />
          </div>

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
              placeholder="Mínimo 6 caracteres"
              required
              minLength={6}
              autoComplete="new-password"
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{ background: 'var(--error-surface)', border: '1px solid var(--error-border)', borderRadius: 8, padding: '10px 14px', color: 'var(--error)', fontSize: 13 }}>
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
              background:   'var(--primary)',
              color:        'var(--text-on-primary)',
              fontSize:     16,
              fontWeight:   600,
              cursor:       loading ? 'default' : 'pointer',
              opacity:      loading ? 0.7 : 1,
              marginTop:    4,
              letterSpacing: '0.02em',
            }}
          >
            {loading ? 'A criar conta…' : 'Criar conta'}
          </button>
        </form>
      </div>

      <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: 'var(--text-subtle)' }}>
        Já tens conta?{' '}
        <Link href="/login" style={{ color: 'var(--action)', fontWeight: 600, textDecoration: 'none' }}>
          Entrar
        </Link>
      </p>
    </div>
  )
}
