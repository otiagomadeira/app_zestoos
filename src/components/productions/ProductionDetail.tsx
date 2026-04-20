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
        <p style={{ fontSize: 11, color: 'rgba(242,233,220,0.45)', letterSpacing: '0.08em', marginBottom: 4 }}>
          FICHA TÉCNICA
        </p>
        <h3 style={{ fontSize: 20, fontWeight: 700, color: '#F2E9DC', lineHeight: 1.2 }}>
          {production.name}
        </h3>
        <p style={{ fontSize: 12, color: 'rgba(242,233,220,0.5)', marginTop: 6 }}>
          Rende{' '}
          <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'rgba(242,233,220,0.8)' }}>
            {production.yield_qty} {production.yield_unit}
          </span>
        </p>
        {production.notes && (
          <p style={{ fontSize: 12, color: 'rgba(242,233,220,0.4)', marginTop: 4, fontStyle: 'italic' }}>
            {production.notes}
          </p>
        )}
      </div>

      {/* Stock atual + botão contar */}
      <div style={{
        background:   'rgba(242,233,220,0.06)',
        border:       '1px solid rgba(242,233,220,0.1)',
        borderRadius: 10,
        padding:      '12px 14px',
        display:      'flex',
        justifyContent: 'space-between',
        alignItems:   'center',
      }}>
        <div>
          <p style={{ fontSize: 11, color: 'rgba(242,233,220,0.45)', letterSpacing: '0.06em' }}>
            STOCK ATUAL
          </p>
          <p style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize:   22,
            fontWeight: 700,
            color:      production.current_qty > 0 ? '#F2E9DC' : 'rgba(242,233,220,0.35)',
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
              height: 40, padding: '0 14px', borderRadius: 8,
              border: '1px solid rgba(242,233,220,0.15)', background: 'rgba(242,233,220,0.06)',
              color: 'rgba(242,233,220,0.6)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            Editar
          </button>
          <button
            onClick={onCount}
            style={{
              height: 40, padding: '0 16px', borderRadius: 8,
              border: '1px solid rgba(196,106,45,0.5)', background: 'rgba(196,106,45,0.15)',
              color: '#C46A2D', fontSize: 13, fontWeight: 600, cursor: 'pointer', letterSpacing: '0.02em',
            }}
          >
            Contar Stock
          </button>
        </div>
      </div>

      {/* Modo de preparação */}
      {production.preparation && (
        <div>
          <p style={{ fontSize: 11, color: 'rgba(242,233,220,0.45)', letterSpacing: '0.08em', marginBottom: 8 }}>
            MODO DE PREPARAÇÃO
          </p>
          <p style={{
            fontSize:   13,
            color:      'rgba(242,233,220,0.75)',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            background: 'rgba(242,233,220,0.04)',
            border:     '1px solid rgba(242,233,220,0.08)',
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
            color:         'rgba(242,233,220,0.45)',
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
                    background:   'rgba(242,233,220,0.05)',
                    border:       '1px solid rgba(242,233,220,0.08)',
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
                          color:         '#C46A2D',
                          background:    'rgba(196,106,45,0.15)',
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
                        color:        '#F2E9DC',
                        whiteSpace:   'nowrap',
                        overflow:     'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {name}
                      </p>
                    </div>
                    <p style={{ fontSize: 11, color: 'rgba(242,233,220,0.4)', marginTop: 2 }}>
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
                      color:      'rgba(242,233,220,0.55)',
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
          borderTop:  '1px solid rgba(242,233,220,0.1)',
          paddingTop: 16,
          display:    'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <p style={{ fontSize: 11, color: 'rgba(242,233,220,0.45)', letterSpacing: '0.06em' }}>
              CUSTO TOTAL
            </p>
            <p style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize:   16,
              fontWeight: 700,
              color:      '#F2E9DC',
              marginTop:  2,
            }}>
              {production.total_cost.toFixed(3)} €
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 11, color: 'rgba(242,233,220,0.45)', letterSpacing: '0.06em' }}>
              CUSTO / {production.yield_unit.toUpperCase()}
            </p>
            <p style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize:   20,
              fontWeight: 700,
              color:      '#C46A2D',
              marginTop:  2,
            }}>
              {production.cost_per_unit.toFixed(3)} €
            </p>
          </div>
        </div>
      )}

      {!hasIngredients && (
        <div style={{ textAlign: 'center', color: 'rgba(242,233,220,0.35)', paddingTop: 20 }}>
          <p style={{ fontSize: 13 }}>Sem ingredientes definidos</p>
        </div>
      )}
    </div>
  )
}
