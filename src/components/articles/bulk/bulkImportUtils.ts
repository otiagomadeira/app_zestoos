import type { ParsedLine } from '@/lib/parseProductLines'
import {
  getCountingModeOptions,
  inferIntent,
  type CountingMode,
} from '@/lib/articleDraft'

// Reconstrói as opções de contagem para uma linha. Mesmo motor que o manual
// (`getCountingModeOptions`) — o `intent` é re-derivado a partir dos campos
// que `parseProductLines` exporta. O multipack é honrado para que o toggle
// apareça em casos como "leite 1L pack 6".
export function lineCountingOptions(line: ParsedLine): CountingMode[] {
  if (line.unit !== 'g' && line.unit !== 'mL' && line.unit !== 'un') return []
  const factor = parseFloat(line.base_per_order)
  const supplierSeed = line.stock_unit
    ? {
        order_unit:        line.stock_unit,
        conversion_factor: !isNaN(factor) && factor > 0 ? factor : undefined,
        source:            'detected' as const,
      }
    : undefined
  const multipack = line.detected_multipack
    ? { count: line.detected_multipack.count, perPack: line.detected_multipack.perPack }
    : undefined
  const intent = inferIntent({ unit: line.unit, supplierSeed, multipack })
  return getCountingModeOptions({ intent })
}
