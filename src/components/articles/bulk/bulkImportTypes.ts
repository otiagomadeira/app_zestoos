// ── Estado UI por linha ──────────────────────────────────────────────────────
// Vive ao lado de ParsedLine. NÃO estendemos ParsedLine porque é o output puro
// do parser (single source of truth partilhado com o motor/manual). Estado UI
// (par_level digitado, toggle de counting, expansão) é responsabilidade desta
// component apenas.

export type LineUiState = {
  parDisplay:           string  // valor digitado em counting_unit (não em base)
  selectedCountingIdx:  number  // 0 default; muda via toggle multipack
  gPerUnit:             string  // só usado quando line.unit === 'un'
  expanded:             boolean
}

export const defaultUiState = (): LineUiState => ({
  parDisplay:          '',
  selectedCountingIdx: 0,
  gPerUnit:            '',
  expanded:            false,
})
