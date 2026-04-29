import { formatBaseQty } from '@/lib/units'
import type { CountingMode } from '@/lib/articleDraft'

// ── CountingPill — toggle quando há multipack, pill estática quando não há ──

export function CountingPill({
  options, selectedIdx, baseUnit, onSelect,
}: {
  options:     CountingMode[]
  selectedIdx: number
  baseUnit:    'g' | 'mL' | 'un'
  onSelect:    (idx: number) => void
}) {
  const isToggle = options.length > 1
  return (
    <div
      role={isToggle ? 'group' : undefined}
      aria-label={isToggle ? 'Formatos de uso' : undefined}
      style={{ display: 'inline-flex', gap: isToggle ? 4 : 0 }}
    >
      {options.map((opt, idx) => {
        const active = idx === selectedIdx
        const showDetail = opt.base_per_unit !== 1
          && opt.count_unit !== 'kg'
          && opt.count_unit !== 'L'
          && opt.count_unit !== 'un'
        return (
          <button
            key={`${opt.count_unit}-${idx}`}
            type="button"
            onClick={isToggle ? () => onSelect(idx) : undefined}
            disabled={!isToggle}
            aria-pressed={isToggle ? active : undefined}
            style={{
              height:        44,
              padding:       '0 10px',
              borderRadius:  20,
              border:        `1px solid ${active && isToggle ? 'var(--action)' : 'var(--border)'}`,
              background:    active && isToggle ? 'var(--action)' : 'var(--surface-2)',
              color:         'var(--text)',
              fontFamily:    'JetBrains Mono, monospace',
              fontSize:      12,
              fontWeight:    700,
              cursor:        isToggle ? 'pointer' : 'default',
              touchAction:   'manipulation',
              display:       'inline-flex',
              alignItems:    'center',
              gap:           4,
              whiteSpace:    'nowrap',
            }}
          >
            {opt.count_unit}
            {showDetail && (
              <span style={{
                fontWeight: 500,
                color:      active && isToggle ? 'var(--text)' : 'var(--text-subtle)',
                opacity:    active && isToggle ? 0.85 : 1,
              }}>
                ({formatBaseQty(opt.base_per_unit, baseUnit)})
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
