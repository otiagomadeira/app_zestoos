'use client'

import type { ProductionDetail } from '@/types/database'

interface Props {
  production: ProductionDetail
  onCount:    () => void
  onEdit:     () => void
}

export default function ProductionDetailPanel({ production, onCount, onEdit }: Props) {
  const hasIngredients = production.ingredients.length > 0
  const hasCost        = production.cost_per_unit > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%', overflowY: 'auto' }}>
      {/* Header */}
      <div>
        <p style={{ fontSize: 11, color: 'var(--text-on-primary-subtle)', letterSpacing: '0.08em', marginBottom: 4 }}>
          FICHA TÉCNICA
        </p>
        <h3 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-on-primary)', lineHeight: 1.2 }}>
          {production.name}
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-on-primary-muted)', marginTop: 6 }}>
          Rende{' '}
          <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-on-primary)' }}>
            {production.yield_qty} {production.yield_unit}
          </span>
        </p>
        {production.notes && (
          <p style={{ fontSize: 12, color: 'var(--text-on-primary-faint)', marginTop: 4, fontStyle: 'italic' }}>
            {production.notes}
          </p>
        )}
      </div>

      {/* Stock atual + botão contar */}
      <div style={{
        background:   'var(--border-on-primary-soft)',
        border:       `1px solid var(--border-on-primary)`,
        borderRadius: 10,
        padding:      '12px 14px',
        display:      'flex',
        justifyContent: 'space-between',
        alignItems:   'center',
      }}>
        <div>
          <p style={{ fontSize: 11, color: 'var(--text-on-primary-subtle)', letterSpacing: '0.06em' }}>
            STOCK ATUAL
          </p>
          <p style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize:   22,
            fontWeight: 700,
            color:      production.current_qty > 0 ? 'var(--text-on-primary)' : 'var(--text-on-primary-faint)',
            marginTop:  2,
          }}>
            {production.current_qty % 1 === 0
              ? production.current_qty.toFixed(0)
              : production.current_qty.toFixed(1)
            } {production.yield_unit}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onEdit}
            style={{
              height: 44, padding: '0 14px', borderRadius: 8,
              border: `1px solid var(--border-on-primary)`, background: 'var(--border-on-primary-soft)',
              color: 'var(--text-on-primary-muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            Editar
          </button>
          <button
            onClick={onCount}
            style={{
              height: 44, padding: '0 16px', borderRadius: 8,
              border: `1px solid var(--action-border)`, background: 'var(--action-glow)',
              color: 'var(--action)', fontSize: 13, fontWeight: 600, cursor: 'pointer', letterSpacing: '0.02em',
            }}
          >
            Contar Stock
          </button>
        </div>
      </div>

      {/* Modo de preparação */}
      {production.preparation && (
        <div>
          <p style={{ fontSize: 11, color: 'var(--text-on-primary-subtle)', letterSpacing: '0.08em', marginBottom: 8 }}>
            MODO DE PREPARAÇÃO
          </p>
          <p style={{
            fontSize:   13,
            color:      'var(--text-on-primary)',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            background: 'var(--border-on-primary-soft)',
            border:     `1px solid var(--border-on-primary-soft)`,
            borderRadius: 8,
            padding:    '12px 14px',
          }}>
            {production.preparation}
          </p>
        </div>
      )}

      {/* Ingredientes */}
      {hasIngredients && (
        <div>
          <p style={{
            fontSize:      11,
            color:         'var(--text-on-primary-subtle)',
            letterSpacing: '0.08em',
            marginBottom:  10,
          }}>
            INGREDIENTES
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {production.ingredients.map((ing, idx) => {
              const name       = ing.article_name ?? ing.sub_production_name ?? '—'
              const isSubRecipe = ing.sub_production_id != null
              const rawQty      = ing.quantity / ing.yield_factor
              const yieldPct    = Math.round(ing.yield_factor * 100)

              return (
                <div
                  key={ing.id ?? idx}
                  style={{
                    background:   'var(--border-on-primary-soft)',
                    border:       `1px solid var(--border-on-primary-soft)`,
                    borderRadius: 8,
                    padding:      '10px 12px',
                    display:      'flex',
                    justifyContent: 'space-between',
                    alignItems:   'center',
                    gap:          12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isSubRecipe && (
                        <span style={{
                          fontSize:      9,
                          fontWeight:    700,
                          color:         'var(--action)',
                          background:    'var(--action-glow)',
                          borderRadius:  4,
                          padding:       '1px 5px',
                          letterSpacing: '0.05em',
                        }}>
                          SUB
                        </span>
                      )}
                      <p style={{
                        fontSize:     13,
                        fontWeight:   500,
                        color:        'var(--text-on-primary)',
                        whiteSpace:   'nowrap',
                        overflow:     'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {name}
                      </p>
                    </div>
                    <p style={{ fontSize: 11, color: 'var(--text-on-primary-faint)', marginTop: 2 }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                        {ing.quantity} {ing.unit}
                      </span>
                      {ing.yield_factor < 1 && (
                        <span> · quebra {100 - yieldPct}% → {rawQty.toFixed(2)} {ing.unit} bruto</span>
                      )}
                    </p>
                  </div>

                  {ing.line_cost != null && ing.line_cost > 0 && (
                    <span style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize:   12,
                      color:      'var(--text-on-primary-muted)',
                      flexShrink: 0,
                    }}>
                      {ing.line_cost.toFixed(3)} €
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Custo total */}
      {hasCost && (
        <div style={{
          borderTop:  `1px solid var(--border-on-primary)`,
          paddingTop: 16,
          display:    'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <p style={{ fontSize: 11, color: 'var(--text-on-primary-subtle)', letterSpacing: '0.06em' }}>
              CUSTO TOTAL
            </p>
            <p style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize:   16,
              fontWeight: 700,
              color:      'var(--text-on-primary)',
              marginTop:  2,
            }}>
              {production.total_cost.toFixed(3)} €
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 11, color: 'var(--text-on-primary-subtle)', letterSpacing: '0.06em' }}>
              CUSTO / {production.yield_unit.toUpperCase()}
            </p>
            <p style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize:   20,
              fontWeight: 700,
              color:      'var(--text-on-primary)',
              marginTop:  2,
            }}>
              {production.cost_per_unit.toFixed(3)} €
            </p>
          </div>
        </div>
      )}

      {!hasIngredients && (
        <div style={{ textAlign: 'center', color: 'var(--text-on-primary-faint)', paddingTop: 20 }}>
          <p style={{ fontSize: 13 }}>Sem ingredientes definidos</p>
        </div>
      )}
    </div>
  )
}
