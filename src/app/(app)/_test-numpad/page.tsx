'use client'

import { useState } from 'react'
import Numpad from '@/components/inventory/Numpad'
import { formatStockQty } from '@/lib/units'

/**
 * Rota de teste isolada para validar o Numpad no iPhone real.
 *
 * URL: /_test-numpad   (não navegável a partir do menu — abrir manualmente)
 *
 * Objetivo:
 *  - Confirmar tamanhos de toque com o polegar
 *  - Confirmar que NÃO abre teclado nativo do iOS
 *  - Confirmar legibilidade do display sob luz de cozinha
 */
export default function TestNumpadPage() {
  const [open,  setOpen]  = useState(false)
  const [value, setValue] = useState<string>('')
  const [savedQty, setSavedQty] = useState<number>(2.4)

  // mock de artigo
  const article = {
    name:        'Tomate cherry',
    currentQty:  savedQty,
    unit:        'kg',
  }

  const handleDigit = (d: string) => {
    // limita a 6 caracteres (ex: 9999.9)
    if (value.length >= 6) return
    // evita zero à esquerda múltiplo: "0" + "5" → "5"
    if (value === '0' && d !== '.') {
      setValue(d)
      return
    }
    setValue(value + d)
  }

  const handleDecimal = () => {
    if (value.includes('.')) return
    if (value === '') { setValue('0.'); return }
    setValue(value + '.')
  }

  const handleBackspace = () => {
    setValue(value.slice(0, -1))
  }

  const handleOk = () => {
    const n = parseFloat(value)
    if (!isNaN(n)) setSavedQty(n)
    setValue('')
    setOpen(false)
  }

  const handleSkip = () => {
    setValue('')
    setOpen(false)
  }

  return (
    <div
      style={{
        minHeight:     '100dvh',
        background:    'var(--bg)',
        padding:       '24px 16px',
        display:       'flex',
        flexDirection: 'column',
        gap:           16,
      }}
    >
      <h1
        style={{
          fontSize:   22,
          fontWeight: 700,
          color:      'var(--text)',
        }}
      >
        Numpad — teste isolado
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        Abre num iPhone real. Tap no card abre o numpad. Confirma:
        <br />
        1) Não aparece teclado do sistema.
        <br />
        2) Botões respondem ao primeiro toque.
        <br />
        3) OK guarda e fecha. ⌫ apaga. × cancela.
      </p>

      {/* Mock card */}
      <button
        type="button"
        onPointerDown={(e) => { e.preventDefault(); setOpen(true) }}
        style={{
          textAlign:    'left',
          background:   'var(--surface)',
          border:       '1px solid var(--border)',
          borderRadius: 12,
          padding:      '14px 16px',
          cursor:       'pointer',
          display:      'flex',
          flexDirection: 'column',
          gap:          6,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
          {article.name}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize:   24,
            fontWeight: 700,
            color:      'var(--text)',
          }}
        >
          {formatStockQty(article.currentQty, article.unit)}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
          tap para contar
        </span>
      </button>

      {/* Sentinel: se este input estivesse focado e o numpad abrisse o
          teclado nativo, veríamos o teclado. É só para verificar que o
          Numpad NÃO causa focus. */}
      <label style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
        Sentinel input (não deve perder focus quando abres o numpad):
      </label>
      <input
        type="text"
        placeholder="podes escrever aqui antes de abrir o numpad"
        style={{
          width:        '100%',
          height:       40,
          background:   'var(--surface)',
          border:       '1px solid var(--border)',
          borderRadius: 8,
          padding:      '0 12px',
          color:        'var(--text)',
          fontSize:     14,
          outline:      'none',
        }}
      />

      <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 8 }}>
        Último valor guardado:{' '}
        <span style={{ fontFamily: 'var(--font-mono), monospace', color: 'var(--text)' }}>
          {formatStockQty(savedQty, article.unit)}
        </span>
      </p>

      {open && (
        <Numpad
          articleName={article.name}
          currentQty={article.currentQty}
          unit={article.unit}
          value={value}
          onDigit={handleDigit}
          onDecimal={handleDecimal}
          onBackspace={handleBackspace}
          onOk={handleOk}
          onSkip={handleSkip}
          onClose={() => { setValue(''); setOpen(false) }}
        />
      )}
    </div>
  )
}
