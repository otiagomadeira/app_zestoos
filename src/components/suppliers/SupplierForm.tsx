'use client'

import { useState } from 'react'
import type { Supplier } from '@/types/database'
import { createSupplier, updateSupplier, toggleSupplierActive } from '@/lib/supabase'

interface Props {
  existing?: Supplier
  onSaved:   (supplier: Supplier) => void
  onCancel:  () => void
}

const labelStyle: React.CSSProperties = {
  fontSize:      11,
  color:         'var(--text-on-primary-muted)',
  letterSpacing: '0.06em',
  marginBottom:  4,
  display:       'block',
}

const inputStyle: React.CSSProperties = {
  width:        '100%',
  height:       40,
  background:   'var(--bg)',
  border:       '1px solid var(--border)',
  borderRadius: 8,
  padding:      '0 12px',
  color:        'var(--text)',
  fontSize:     14,
  outline:      'none',
}

export default function SupplierForm({ existing, onSaved, onCancel }: Props) {
  const isEdit = !!existing

  const [name,  setName]  = useState(existing?.name  ?? '')
  const [phone, setPhone] = useState(existing?.phone ?? '')
  const [email, setEmail] = useState(existing?.email ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const handleSave = async () => {
    if (!name.trim()) return setError('Nome é obrigatório')
    setSaving(true)
    setError(null)
    try {
      const input = {
        name:  name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        notes: notes.trim() || undefined,
      }
      if (isEdit && existing) {
        await updateSupplier(existing.id, input)
        onSaved({ ...existing, ...input } as Supplier)
      } else {
        onSaved(await createSupplier(input))
      }
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async () => {
    if (!existing) return
    setSaving(true)
    setError(null)
    try {
      const newActive = !existing.is_active
      await toggleSupplierActive(existing.id, newActive)
      onSaved({ ...existing, is_active: newActive })
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Erro ao alterar estado')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ marginBottom: 20, flexShrink: 0 }}>
        <button
          onClick={onCancel}
          style={{ background: 'none', border: 'none', color: 'var(--text-on-primary-muted)', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12 }}
        >
          ← Cancelar
        </button>
        <p style={{ fontSize: 11, color: 'var(--text-on-primary-subtle)', letterSpacing: '0.08em', marginBottom: 4 }}>
          {isEdit ? 'EDITAR FORNECEDOR' : 'NOVO FORNECEDOR'}
        </p>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-on-primary)' }}>
          {isEdit ? existing.name : 'Novo Fornecedor'}
        </h3>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>NOME</label>
          <input
            type="text"
            placeholder="ex: Apicola Nacional"
            value={name}
            onChange={e => setName(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>TELEMÓVEL (opcional)</label>
          <input
            type="tel"
            placeholder="ex: 912 345 678"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>EMAIL (opcional)</label>
          <input
            type="email"
            placeholder="ex: comercial@fornecedor.pt"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>NOTAS (opcional)</label>
          <textarea
            placeholder="Observações, condições comerciais…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            style={{ ...inputStyle, height: 'auto', padding: '10px 12px', resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {isEdit && (
          <div style={{ paddingTop: 16, borderTop: `1px solid var(--border-on-primary-soft)` }}>
            <button
              onClick={handleToggleActive}
              disabled={saving}
              style={{
                width:        '100%',
                height:       44,
                borderRadius: 8,
                border:       existing.is_active
                  ? `1px solid var(--error-border)`
                  : '1px solid var(--success-border)',
                background:   existing.is_active
                  ? 'var(--error-surface)'
                  : 'var(--success-surface)',
                color:        existing.is_active ? 'var(--error)' : 'var(--success)',
                fontSize:     13,
                fontWeight:   600,
                cursor:       'pointer',
              }}
            >
              {existing.is_active ? 'Desativar Fornecedor' : 'Reativar Fornecedor'}
            </button>
          </div>
        )}

        {error && (
          <div style={{ background: 'var(--error-surface)', border: `1px solid var(--error-border)`, borderRadius: 8, padding: '10px 14px', color: 'var(--error-on-primary)', fontSize: 13 }}>
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ paddingTop: 16, borderTop: `1px solid var(--border-on-primary-soft)`, marginTop: 16, display: 'flex', gap: 10, flexShrink: 0 }}>
        <button
          onClick={onCancel}
          style={{ flex: 1, height: 48, borderRadius: 10, border: `1px solid var(--border-on-primary)`, background: 'transparent', color: 'var(--text-on-primary-muted)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
        >
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ flex: 2, height: 48, borderRadius: 10, border: 'none', background: 'var(--action)', color: 'var(--text-on-primary)', fontSize: 15, fontWeight: 600, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}
        >
          {saving ? 'A guardar…' : isEdit ? 'Guardar Alterações' : 'Guardar Fornecedor'}
        </button>
      </div>
    </div>
  )
}
