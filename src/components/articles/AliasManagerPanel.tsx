'use client'

import { useOrgAliases } from '@/hooks/useOrgAliases'

interface Props {
  onClose: () => void
}

export default function AliasManagerPanel({ onClose }: Props) {
  const { aliases, loading, deleteAlias } = useOrgAliases()

  const rows = Array.from(aliases.entries()).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' }}>
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={onClose}
          style={{ width: 36, height: 36, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          aria-label="Fechar"
        >
          ←
        </button>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Aliases aprendidos</h2>
          <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
            {loading ? '…' : rows.length === 0 ? 'Nenhum ainda' : `${rows.length} alias${rows.length !== 1 ? 'es' : ''}`}
          </p>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {loading && (
          <p style={{ color: 'var(--text-subtle)', fontSize: 14, textAlign: 'center', paddingTop: 40 }}>A carregar…</p>
        )}
        {!loading && rows.length === 0 && (
          <p style={{ color: 'var(--text-subtle)', fontSize: 14, textAlign: 'center', paddingTop: 40 }}>
            Os aliases são aprendidos automaticamente quando corriges um nome durante a importação ou edição de artigos.
          </p>
        )}

        {rows.map(([key, canonical]) => (
          <div
            key={key}
            style={{
              display:        'flex',
              alignItems:     'center',
              gap:            10,
              padding:        '10px 12px',
              marginBottom:   4,
              background:     'var(--surface)',
              borderRadius:   8,
              border:         '1px solid var(--border)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {key}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2, display: 'block' }}>
                → {canonical}
              </span>
            </div>
            <button
              onClick={() => deleteAlias(key)}
              style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--error)', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label={`Apagar alias "${key}"`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
