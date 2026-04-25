'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Article } from '@/types/database'
import { createArticle, createArticleSizeIfMissing } from '@/lib/supabase'
import { KITCHEN_UNITS, formatUnit } from '@/lib/units'
import { parseProductLines, recomputeDuplicates, type ParsedLine } from '@/lib/parseProductLines'
import { suggestCategory } from '@/lib/categoryKeywords'
import { maybeLearnAlias, normalizeKey } from '@/lib/ingredientDictionary'
import { useOrgAliases } from '@/hooks/useOrgAliases'

// ── Estilos base (consistentes com os outros forms) ───────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: 'var(--text-on-primary-muted)',
  marginBottom: 4,
  display: 'block',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 44,
  background: 'var(--border-on-primary-soft)',
  border: `1px solid var(--border-on-primary)`,
  borderRadius: 6,
  padding: '0 8px',
  color: 'var(--text-on-primary)',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
}

// ── Hint de embalagem detetada (read-only) ────────────────────────────────────
// Mostra `order_unit · qty formatted` quando o parser detetou supplierSeed.
// Multipack ("6x1L") preserva o formato reconhecível pelo chef ("6 x 1 L").

function SeedHint({ line }: { line: ParsedLine }) {
  if (!line.stock_unit) return null
  const qty    = parseFloat(line.base_per_order)
  const hasQty = !isNaN(qty) && qty > 0 && line.unit.trim() !== ''
  const mp     = line.detected_multipack

  let body: string
  if (mp) {
    body = `${line.stock_unit} · ${mp.count} x ${formatUnit(mp.perPack, line.unit)}`
  } else if (hasQty) {
    body = `${line.stock_unit} · ${formatUnit(qty, line.unit)}`
  } else {
    body = line.stock_unit
  }

  return (
    <p style={{
      fontSize:      11,
      color:         'var(--text-on-primary-faint)',
      fontFamily:    'JetBrains Mono, monospace',
      letterSpacing: '0.02em',
      margin:        0,
    }}>
      {body}
    </p>
  )
}

// ── Linha da tabela de preview ────────────────────────────────────────────────

type LineRowProps = {
  line: ParsedLine
  onChange: (id: string, field: keyof ParsedLine, value: string) => void
  onDelete: (id: string) => void
  onApplySuggestion: (id: string, category: string) => void
  onResolved?: (id: string) => void
  isResolved?: boolean
}

function LineRow({ line, onChange, onDelete, onApplySuggestion: _onApplySuggestion, onResolved, isResolved }: LineRowProps) {
  const isInvalid = line.name.trim() === '' || line.unit.trim() === ''
  const unitMissing = line.unit.trim() === ''

  return (
    <div style={{
      background:    isInvalid ? 'var(--error-surface)' : isResolved ? 'var(--success-surface-on-primary)' : 'var(--border-on-primary-soft)',
      border:        `1px solid ${isInvalid ? 'var(--error-border)' : isResolved ? 'var(--success-border-on-primary)' : 'var(--border-on-primary-soft)'}`,
      borderRadius:  8,
      padding:       '10px 12px',
      display:       'flex',
      flexDirection: 'column',
      gap:           8,
    }}>

      {/* Fila 1: Nome + UN. Base */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 88px', gap: 6, alignItems: 'end' }}>
        <div>
          <label style={labelStyle}>NOME</label>
          <input
            value={line.name}
            onChange={e => onChange(line.id, 'name', e.target.value)}
            placeholder="Nome do produto"
            style={{ ...inputStyle, border: line.name.trim() === '' ? `1px solid var(--error)` : inputStyle.border }}
          />
        </div>
        <div>
          {unitMissing ? (
            <>
              <span style={{ ...labelStyle, color: 'var(--warning-text)' }}>Seleciona unidade</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['g', 'mL', 'un'] as const).map(u => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => { onChange(line.id, 'unit', u); onResolved?.(line.id) }}
                    style={{
                      flex:         1,
                      height:       44,
                      borderRadius: 6,
                      border:       `1px solid var(--action-border)`,
                      background:   'var(--action-surface)',
                      color:        'var(--action)',
                      fontSize:     11,
                      fontWeight:   700,
                      cursor:       'pointer',
                      fontFamily:   'JetBrains Mono, monospace',
                    }}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <label style={labelStyle}>UN. BASE</label>
              <input
                list="bulk-units-datalist"
                value={line.unit}
                onChange={e => onChange(line.id, 'unit', e.target.value)}
                placeholder="g, kg, un…"
                style={inputStyle}
              />
            </>
          )}
        </div>
      </div>

      {/* Hint do parser — embalagem detetada */}
      <SeedHint line={line} />

      {/* Fila 2: Categoria + Eliminar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, alignItems: 'end' }}>
        <div>
          <label style={labelStyle}>
            CATEGORIA
            {!line.categoryConfident && line.category && (
              <span title="Categoria inferida com baixa confiança — verifica antes de guardar" style={{ marginLeft: 4, color: 'var(--warning)', fontSize: 10 }}>?</span>
            )}
          </label>
          <input
            value={line.category}
            onChange={e => onChange(line.id, 'category', e.target.value)}
            placeholder="opcional"
            style={{
              ...inputStyle,
              border: !line.categoryConfident && line.category
                ? `1px solid var(--warning)`
                : inputStyle.border,
            }}
          />
        </div>
        <button
          onClick={() => onDelete(line.id)}
          title="Eliminar linha"
          style={{
            alignSelf:    'flex-end',
            width:        44,
            height:       44,
            borderRadius: 6,
            border:       `1px solid var(--border-on-primary)`,
            background:   'var(--error-surface)',
            color:        'var(--text-on-primary-muted)',
            fontSize:     16,
            cursor:       'pointer',
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            flexShrink:   0,
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}

// ── Cards de preview ─────────────────────────────────────────────────────────

type CardSharedProps = {
  line:              ParsedLine
  onChange:          (id: string, field: keyof ParsedLine, value: string) => void
  onDelete:          (id: string) => void
  onApplySuggestion: (id: string, category: string) => void
}

function OkCard({
  line, isForced, isResolved, onChange, onDelete, onApplySuggestion,
}: CardSharedProps & {
  isForced:   boolean
  isResolved: boolean
}) {
  return (
    <div>
      {isForced && (
        <div style={{ marginBottom: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--success-on-primary)', background: 'var(--success-surface-on-primary)', border: `1px solid var(--success-border-on-primary)`, borderRadius: 4, padding: '1px 6px' }}>
            NOVO
          </span>
        </div>
      )}
      <LineRow
        line={line}
        onChange={onChange}
        onDelete={onDelete}
        onApplySuggestion={onApplySuggestion}
        isResolved={isResolved}
      />
    </div>
  )
}

function PartialCard({
  line, onChange, onDelete, onApplySuggestion, onResolved,
}: CardSharedProps & { onResolved: (id: string) => void }) {
  return (
    <LineRow
      line={line}
      onChange={onChange}
      onDelete={onDelete}
      onApplySuggestion={onApplySuggestion}
      onResolved={onResolved}
    />
  )
}

function DuplicateCard({
  line, onForceCreate, onDelete,
}: { line: ParsedLine; onForceCreate: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <div style={{ background: 'var(--border-on-primary-soft)', border: `1px solid var(--border-on-primary-soft)`, borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: 13, color: 'var(--text-on-primary-faint)', textDecoration: 'line-through' }}>
          {line.name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-on-primary-faint)', marginLeft: 8 }}>
          {line.isDuplicateInBatch && !line.isDuplicate ? 'repetido na lista' : 'já existe'}
        </span>
        <SeedHint line={line} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button
          onClick={() => onForceCreate(line.id)}
          style={{ height: 44, borderRadius: 6, border: `1px solid var(--action-border)`, background: 'var(--action-surface)', color: 'var(--action)', fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '0 10px', whiteSpace: 'nowrap' }}
        >
          Criar mesmo assim
        </button>
        <button
          onClick={() => onDelete(line.id)}
          title="Remover da lista"
          style={{ width: 44, height: 44, borderRadius: 6, border: `1px solid var(--border-on-primary-soft)`, background: 'none', color: 'var(--text-on-primary-faint)', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
          ×
        </button>
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

type Props = {
  articles:        Article[]
  onCancel:        () => void
  onBatchCreated:  () => void
}

export default function BulkImportPanel({ articles, onCancel, onBatchCreated }: Props) {
  const router = useRouter()
  const { aliases, learnAlias } = useOrgAliases()
  const [step,         setStep]         = useState<'input' | 'preview' | 'success'>('input')
  const [rawText,      setRawText]      = useState('')
  const [lines,        setLines]        = useState<ParsedLine[]>([])
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [result,       setResult]       = useState<{ created: number; failed: string[] } | null>(null)
  const [successCount, setSuccessCount] = useState(0)

  // Feedback visual: IDs que acabaram de ser resolvidos (highlight verde ~800ms)
  const [justResolvedIds, setJustResolvedIds] = useState<Set<string>>(new Set())
  // Override local de duplicados: IDs que o utilizador forçou criar
  const [forcedIds, setForcedIds] = useState<Set<string>>(new Set())

  const handleResolved = useCallback((id: string) => {
    setJustResolvedIds(s => new Set([...s, id]))
    setTimeout(() => {
      setJustResolvedIds(s => { const next = new Set(s); next.delete(id); return next })
    }, 800)
  }, [])

  const handleForceCreate = useCallback((id: string) => {
    setForcedIds(s => new Set([...s, id]))
    setJustResolvedIds(s => new Set([...s, id]))
    setTimeout(() => {
      setJustResolvedIds(s => { const next = new Set(s); next.delete(id); return next })
    }, 800)
  }, [])

  const handleIgnoreAllDuplicates = useCallback((ids: string[]) => {
    setLines(prev => prev.map(l => ids.includes(l.id) ? { ...l, deleted: true } : l))
  }, [])

  // ── Step: Input ─────────────────────────────────────────────────────────────

  const lineCount = rawText.split('\n').filter(l => l.trim() !== '').length

  const handleProcess = () => {
    const parsed = parseProductLines(rawText, articles, aliases)
    setLines(parsed)
    setError(null)
    setResult(null)
    setStep('preview')
  }

  // ── Step: Preview ───────────────────────────────────────────────────────────

  const handleLineChange = useCallback((id: string, field: keyof ParsedLine, value: string) => {
    setLines(prev => {
      const updated = prev.map(l => {
        if (l.id !== id) return l
        const next = { ...l, [field]: value }
        if (field === 'name') {
          // Utilizador editou o nome no preview → marcar para não aprender alias automático
          next.wasManuallyEdited = true
          const catResult = suggestCategory({ name: value, unit: l.unit })
          next.suggestedCategory   = catResult.category
          next.categoryConfident   = catResult.confident
        }
        return next
      })
      if (field === 'name') return recomputeDuplicates(updated, articles)
      return updated
    })
  }, [articles])

  const handleApplySuggestion = useCallback((id: string, category: string) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, category } : l))
  }, [])

  const handleDelete = useCallback((id: string) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, deleted: true } : l))
  }, [])

  const activeLines = lines.filter(l => !l.deleted)

  // Group by name: first occurrence = primary article, rest = size variants
  const nameToFirstId = new Map<string, string>()
  const variantsByPrimaryId = new Map<string, ParsedLine[]>()
  for (const line of activeLines) {
    const key = normalizeKey(line.name)
    if (line.name.trim() === '') continue
    if (!nameToFirstId.has(key)) {
      nameToFirstId.set(key, line.id)
    } else {
      const pid      = nameToFirstId.get(key)!
      const existing = variantsByPrimaryId.get(pid) ?? []
      existing.push(line)
      variantsByPrimaryId.set(pid, existing)
    }
  }
  const primaryIds   = new Set(nameToFirstId.values())
  const primaryLines = activeLines.filter(l => primaryIds.has(l.id) || l.name.trim() === '')

  // Grupos para o preview e submit
  // forcedIds: duplicados que o utilizador decidiu criar mesmo assim — saem de dupLines
  const isEffDup     = (l: ParsedLine) => (l.isDuplicate || l.isDuplicateInBatch) && !forcedIds.has(l.id)
  const dupLines     = primaryLines.filter(l => isEffDup(l))
  const partialLines = primaryLines.filter(l =>
    !isEffDup(l) && (l.name.trim() === '' || l.unit.trim() === '')
  )
  const okLines = primaryLines.filter(l =>
    !isEffDup(l) && l.name.trim() !== '' && l.unit.trim() !== ''
  )
  const ignoredCount = partialLines.length + dupLines.length

  const handleCreate = async () => {
    setError(null)
    setSaving(true)

    const toCreate = okLines
    const failed: string[] = []

    const results = await Promise.allSettled(
      toCreate.map(async line => {
        const savedName = line.name.trim()
        maybeLearnAlias(line.originalName, savedName, aliases, learnAlias, line.wasManuallyEdited)
        const article = await createArticle({
          name:      savedName,
          unit:      line.unit.trim(),
          par_level: parseFloat(line.par_level) || 0,
          category:  line.category.trim() || undefined,
        })

        // Embalagem operacional como article_size — só quando o parser detetou
        // packaging útil e não há conversão trivial. Falha não bloqueia: o
        // fallback unit/1 ainda mantém o artigo utilizável no inventário.
        const stockUnit    = line.stock_unit.trim()
        const basePerOrder = parseFloat(line.base_per_order)
        if (stockUnit && stockUnit !== line.unit.trim() && basePerOrder > 0) {
          try {
            await createArticleSizeIfMissing(article.id, stockUnit, basePerOrder)
          } catch (e) {
            console.error('createArticleSize falhou:', { articleId: article.id, label: stockUnit, error: e })
          }
        }
        return article
      })
    )

    results.forEach((r, i) => {
      if (r.status === 'rejected') failed.push(toCreate[i].name)
    })

    setSaving(false)

    if (failed.length === 0) {
      setSuccessCount(toCreate.length)
      onBatchCreated()
      setStep('success')
    } else {
      setResult({ created: toCreate.length - failed.length, failed })
      if (failed.length < toCreate.length) {
        // Criação parcial — atualizar lista mas manter painel aberto com erro
        onBatchCreated()
      }
    }
  }

  const handleContinueAdding = () => {
    setStep('input')
    setRawText('')
    setLines([])
    setError(null)
    setResult(null)
    setSuccessCount(0)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* Datalists de unidades (partilhados) */}
      <datalist id="bulk-units-datalist">
        {KITCHEN_UNITS.map(u => <option key={u} value={u} />)}
      </datalist>
      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          {step === 'preview' && (
            <button
              onClick={() => setStep('input')}
              style={{ background: 'none', border: 'none', color: 'var(--text-on-primary-muted)', fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1 }}
            >
              ←
            </button>
          )}
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-on-primary)', margin: 0 }}>
            {step === 'input' ? 'Importar Artigos' : 'Pré-visualização'}
          </h2>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-on-primary-muted)', margin: 0 }}>
          {step === 'input'
            ? 'Cola ou escreve uma lista — um produto por linha.'
            : [
                `${okLines.length} pronto${okLines.length !== 1 ? 's' : ''}`,
                partialLines.length > 0 ? `${partialLines.length} a resolver` : null,
                dupLines.length > 0 ? `${dupLines.length} duplicado${dupLines.length !== 1 ? 's' : ''}` : null,
              ].filter(Boolean).join(' · ')}
        </p>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{ background: 'var(--error-surface)', border: `1px solid var(--error-border)`, borderRadius: 8, padding: '10px 14px', color: 'var(--text-on-primary)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* ── Result banner (criação parcial) ── */}
      {result && result.failed.length > 0 && (
        <div style={{ background: 'var(--error-surface)', border: `1px solid var(--error-border)`, borderRadius: 8, padding: '10px 14px', color: 'var(--text-on-primary)', fontSize: 13, marginBottom: 16 }}>
          <strong>{result.created} criado{result.created !== 1 ? 's' : ''}.</strong> Falharam: {result.failed.join(', ')}
        </div>
      )}

      {/* ── Conteúdo ── */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

        {step === 'success' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 48, paddingBottom: 48 }}>
            <div style={{ fontSize: 32, marginBottom: 8, color: 'var(--success-on-primary)' }}>✓</div>
            <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-on-primary)', margin: 0 }}>
              {successCount} artigo{successCount !== 1 ? 's' : ''} criado{successCount !== 1 ? 's' : ''}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-on-primary-faint)', margin: 0 }}>
              com sucesso
            </p>
          </div>
        )}

        {step === 'input' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={labelStyle}>LISTA DE PRODUTOS</label>
              <p style={{ fontSize: 12, color: 'var(--text-on-primary-faint)', marginBottom: 8, lineHeight: 1.5 }}>
                Exemplo:<br />
                Tomate pelado lata 2.5kg<br />
                Mozzarella fresca 125g<br />
                Natas 1L
              </p>
              <textarea
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                placeholder={'Um produto por linha…\nTomate pelado 2.5kg\nMozzarella fresca 125g'}
                rows={12}
                style={{
                  ...inputStyle,
                  height:     'auto',
                  padding:    '10px 12px',
                  resize:     'vertical',
                  lineHeight: 1.6,
                  fontSize:   15,
                  fontFamily: 'inherit',
                }}
              />
            </div>
            {lineCount > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-on-primary-faint)', margin: 0 }}>
                {lineCount} linha{lineCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        )}

        {step === 'preview' && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {primaryLines.length === 0 && (
              <p style={{ color: 'var(--text-on-primary-faint)', fontSize: 14, textAlign: 'center', paddingTop: 32 }}>
                Nenhuma linha válida. Volta atrás e revê o texto.
              </p>
            )}

            {/* ── PRONTOS ── */}
            {okLines.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--success-on-primary)', marginBottom: 10, paddingTop: 4 }}>
                  PRONTOS ({okLines.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {okLines.map(line => (
                    <OkCard
                      key={line.id}
                      line={line}
                      isForced={forcedIds.has(line.id)}
                      isResolved={justResolvedIds.has(line.id)}
                      onChange={handleLineChange}
                      onDelete={handleDelete}
                      onApplySuggestion={handleApplySuggestion}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── A RESOLVER ── */}
            {partialLines.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--action)', marginBottom: 10 }}>
                  A RESOLVER ({partialLines.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {partialLines.map(line => (
                    <PartialCard
                      key={line.id}
                      line={line}
                      onChange={handleLineChange}
                      onDelete={handleDelete}
                      onApplySuggestion={handleApplySuggestion}
                      onResolved={handleResolved}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── DUPLICADOS ── */}
            {dupLines.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-on-primary-faint)', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>DUPLICADOS ({dupLines.length})</span>
                  <button
                    onClick={() => handleIgnoreAllDuplicates(dupLines.map(l => l.id))}
                    style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-on-primary-faint)', background: 'none', border: `1px solid var(--border-on-primary)`, borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}
                  >
                    Ignorar todos
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {dupLines.map(line => (
                    <DuplicateCard
                      key={line.id}
                      line={line}
                      onForceCreate={handleForceCreate}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer com CTAs ── */}
      <div style={{ paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {step === 'success' && (
          <>
            <button
              onClick={() => router.push('/')}
              style={{
                height:       44,
                borderRadius: 8,
                border:       'none',
                background:   'var(--primary)',
                color:        'var(--text-on-primary)',
                fontSize:     14,
                fontWeight:   600,
                cursor:       'pointer',
              }}
            >
              Ir para inventário
            </button>
            <button
              onClick={handleContinueAdding}
              style={{ height: 44, borderRadius: 8, border: 'none', background: 'none', color: 'var(--text-on-primary-muted)', fontSize: 13, cursor: 'pointer' }}
            >
              Continuar a adicionar
            </button>
          </>
        )}

        {step === 'input' && (
          <>
            <button
              onClick={handleProcess}
              disabled={lineCount === 0}
              style={{
                height:       44,
                borderRadius: 8,
                border:       'none',
                background:   lineCount === 0 ? 'var(--action-disabled)' : 'var(--action)',
                color:        lineCount === 0 ? 'var(--text-on-primary-faint)' : 'var(--text-on-primary)',
                fontSize:     14,
                fontWeight:   600,
                cursor:       lineCount === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              Processar lista{lineCount > 0 ? ` (${lineCount})` : ''}
            </button>
            <button
              onClick={onCancel}
              style={{ height: 44, borderRadius: 8, border: 'none', background: 'none', color: 'var(--text-on-primary-muted)', fontSize: 13, cursor: 'pointer' }}
            >
              Cancelar
            </button>
          </>
        )}

        {step === 'preview' && (
          <>
            <button
              onClick={handleCreate}
              disabled={saving || okLines.length === 0}
              style={{
                height:       44,
                borderRadius: 8,
                border:       'none',
                background:   saving || okLines.length === 0 ? 'var(--action-disabled)' : 'var(--action)',
                color:        saving || okLines.length === 0 ? 'var(--text-on-primary-faint)' : 'var(--text-on-primary)',
                fontSize:     14,
                fontWeight:   600,
                cursor:       saving ? 'wait' : okLines.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'A criar…' : `Criar ${okLines.length} artigo${okLines.length !== 1 ? 's' : ''}`}
            </button>
            {!saving && ignoredCount > 0 && (
              <p style={{ fontSize: 11, color: 'var(--text-on-primary-faint)', textAlign: 'center', margin: 0 }}>
                {ignoredCount} ignorado{ignoredCount !== 1 ? 's' : ''}{partialLines.length > 0 && dupLines.length > 0 ? ` (${partialLines.length} incompleto${partialLines.length !== 1 ? 's' : ''} · ${dupLines.length} duplicado${dupLines.length !== 1 ? 's' : ''})` : ''}
              </p>
            )}
            <button
              onClick={onCancel}
              disabled={saving}
              style={{ height: 44, borderRadius: 8, border: 'none', background: 'none', color: 'var(--text-on-primary-muted)', fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer' }}
            >
              Cancelar
            </button>
          </>
        )}
      </div>
    </div>
  )
}
