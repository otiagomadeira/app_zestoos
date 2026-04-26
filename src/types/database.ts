// ============================================================
// ZESTO OS — Database Types (mirrors Supabase schema)
// ============================================================

export type MovementType = 'PURCHASE' | 'ADJUSTMENT' | 'WASTE' | 'CONSUMPTION' | 'PRODUCTION_IN' | 'PRODUCTION_OUT'
export type OrderStatus  = 'DRAFT' | 'SENT' | 'RECEIVED' | 'CANCELLED'
export type UserRole     = 'owner' | 'member'

// ── Tables ──────────────────────────────────────────────────

export interface Organization {
  id:         string
  name:       string
  slug:       string
  is_active:  boolean
  created_at: string
}

export interface Profile {
  id:              string
  organization_id: string
  full_name:       string | null
  role:            UserRole
  created_at:      string
}

export interface Supplier {
  id:         string
  name:       string
  email:      string | null
  phone:      string | null
  notes:      string | null
  is_active:  boolean
  created_at: string
  updated_at: string
}

export interface Article {
  id:          string
  name:        string
  unit:        string        // base_unit: g, mL, un
  par_level:   number        // em base_unit
  category:    string | null
  is_active:   boolean
  g_per_unit:  number | null // peso médio em g de 1 un (ovos, porções…); null = não aplicável
  created_at:  string
  updated_at:  string
}

export interface ArticleSupplier {
  id:                string
  article_id:        string
  supplier_id:       string
  supplier_ref:      string | null
  price:             number
  order_unit:        string
  conversion_factor: number        // base_units por order_unit
  is_preferred:      boolean
  created_at:        string
  updated_at:        string
}

export interface ArticleSize {
  id:            string
  article_id:    string
  label:         string         // ex: 'caixa', 'frasco', 'saco 25kg'
  base_per_unit: number         // base_units por 1 article_size
  sort_order:    number
  created_at:    string
}

export interface Order {
  id:          string
  supplier_id: string
  status:      OrderStatus
  notes:       string | null
  sent_at:     string | null
  received_at: string | null
  created_at:  string
  updated_at:  string
}

export interface OrderItem {
  id:                  string
  order_id:            string
  article_id:          string
  quantity_ordered:    number
  order_unit:          string
  price_snapshot:      number | null
  conversion_snapshot: number | null
  quantity_received:   number | null
  received_at:         string | null
  created_at:          string
  updated_at:          string
}

export interface StockMovement {
  id:                string
  article_id:        string
  type:              MovementType
  quantity:          number
  unit:              string
  notes:             string | null
  order_item_id:     string | null
  counted_at:        string
  count_session_id:  string | null  // sessão de contagem inline (NULL para movements antigos / não-inline)
  created_at:        string
}

// ── Views ────────────────────────────────────────────────────

export interface CurrentStock {
  article_id:                      string
  name:                            string
  unit:                            string        // base_unit (g, mL, un)
  stock_unit:                      string        // unidade de contagem; derivada do fornecedor preferido (=unit se sem supplier)
  base_per_stock:                  number        // base_units por stock_unit (=1 se sem supplier)
  par_level:                       number        // em base_unit
  category:                        string | null
  current_qty:                     number        // soma dos movimentos em base_unit
  diff_from_par:                   number        // current_qty - par_level (em base_unit)
  packaging_count:                 number        // nº de embalagens distintas (sizes ∪ suppliers ∪ fallback, deduped)
  single_packaging_label:          string | null // label da única embalagem (apenas se packaging_count = 1)
  single_packaging_base_per_unit:  number | null // base_units por 1 embalagem (apenas se packaging_count = 1)
}

export interface OrderSuggestion {
  article_id:              string
  name:                    string
  unit:                    string
  par_level:               number
  current_qty:             number
  diff_from_par:           number
  qty_to_order:            number
  supplier_id:             string | null
  supplier_name:           string | null
  order_unit:              string | null
  price:                   number | null
  conversion_factor:       number | null  // base_units por order_unit
  order_qty_in_order_unit: number | null
}

// ── Productions ─────────────────────────────────────────────

export interface Production {
  id:          string
  name:        string
  yield_qty:   number
  yield_unit:  string
  notes:       string | null
  preparation: string | null
  is_active:   boolean
  created_at:  string
  updated_at:  string
}

export interface ProductionIngredient {
  id:                string
  production_id:     string
  article_id:        string | null
  sub_production_id: string | null
  quantity:          number
  unit:              string
  yield_factor:      number
  sort_order:        number
  created_at:        string
}

export interface ProductionStock {
  id:            string
  production_id: string
  quantity:      number
  unit:          string
  notes:         string | null
  counted_at:    string
  created_at:    string
}

export interface CurrentProductionStock {
  production_id: string
  name:          string
  yield_qty:     number
  unit:          string
  current_qty:   number
  counted_at:    string | null
}

export interface ProductionWithCost {
  production_id: string
  name:          string
  yield_qty:     number
  yield_unit:    string
  total_cost:    number
  cost_per_unit: number
}

export interface IngredientDetail extends ProductionIngredient {
  article_name?:        string
  sub_production_name?: string
  unit_cost?:           number
  line_cost?:           number
}

export interface ProductionDetail extends Production {
  ingredients:   IngredientDetail[]
  total_cost:    number
  cost_per_unit: number
  current_qty:   number
}
