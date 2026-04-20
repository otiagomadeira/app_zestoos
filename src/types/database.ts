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
  unit:        string        // base_unit: g, mL, un — para receitas
  stock_unit:  string | null // unidade de contagem; null = igual a unit
  par_level:   number        // em stock_unit (ou base_unit se stock_unit=null)
  category:    string | null
  is_active:   boolean
  created_at:  string
  updated_at:  string
}

export interface ArticleSupplier {
  id:                  string
  article_id:          string
  supplier_id:         string
  supplier_ref:        string | null
  price:               number
  order_unit:          string
  conversion_factor:   number        // stock_units por order_unit
  base_per_order_unit: number | null // base_units por order_unit; null = não configurado
  is_preferred:        boolean
  created_at:          string
  updated_at:          string
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
  id:            string
  article_id:    string
  type:          MovementType
  quantity:      number
  unit:          string
  notes:         string | null
  order_item_id: string | null
  counted_at:    string
  created_at:    string
}

// ── Views ────────────────────────────────────────────────────

export interface CurrentStock {
  article_id:       string
  name:             string
  unit:             string        // base_unit
  stock_unit:       string        // COALESCE(stock_unit, unit)
  par_level:        number        // em stock_unit
  category:         string | null
  base_per_stock:   number        // base_units por stock_unit (derivado do fornecedor)
  current_qty_base: number        // soma dos movements em base_unit (para saveStockCount)
  current_qty:      number        // em stock_unit (para display)
  diff_from_par:    number        // em stock_unit
}

export interface OrderSuggestion {
  article_id:              string
  name:                    string
  unit:                    string        // base_unit
  stock_unit:              string        // unidade de contagem
  par_level:               number        // em stock_unit
  current_qty:             number        // em stock_unit
  diff_from_par:           number        // em stock_unit
  qty_to_order:            number        // em stock_unit
  supplier_id:             string | null
  supplier_name:           string | null
  order_unit:              string | null
  price:                   number | null
  conversion_factor:       number | null // stock_units por order_unit
  base_per_order_unit:     number | null // base_units por order_unit
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

// View: última contagem por produção
export interface CurrentProductionStock {
  production_id: string
  name:          string
  yield_qty:     number
  unit:          string
  current_qty:   number
  counted_at:    string | null
}

// View: custo calculado por produção
export interface ProductionWithCost {
  production_id: string
  name:          string
  yield_qty:     number
  yield_unit:    string
  total_cost:    number
  cost_per_unit: number
}

// Ingrediente enriquecido para UI (join com artigo/sub-produção)
export interface IngredientDetail extends ProductionIngredient {
  article_name?:        string
  sub_production_name?: string
  unit_cost?:           number  // custo por unidade base do ingrediente
  line_cost?:           number  // (quantity / yield_factor) * unit_cost
}

// Produção completa com ingredientes e custo (para painel de detalhe)
export interface ProductionDetail extends Production {
  ingredients:   IngredientDetail[]
  total_cost:    number
  cost_per_unit: number
  current_qty:   number
}

// ── Stock Count Lines ────────────────────────────────────────

export interface StockCountLine {
  id:             string
  movement_id:    string
  organization_id: string
  size_label:     string   // ex: "saco 200g" (legível)
  qty:            number   // nº de unidades deste tamanho
  base_per_unit:  number   // base_units por unidade
  base_qty:       number   // = qty × base_per_unit
  created_at:     string
}

// ── UI Helpers ───────────────────────────────────────────────

export interface StockCountEntry {
  article_id:       string
  name:             string
  unit:             string   // base_unit
  stock_unit:       string   // unidade de contagem (display)
  par_level:        number   // em stock_unit
  base_per_stock:   number   // base_units por stock_unit
  current_qty_base: number   // em base_unit (para delta)
  current_qty:      number   // em stock_unit (display inicial)
  new_qty:          string   // valor a digitar no keypad (em stock_unit)
  dirty:            boolean  // utilizador tocou neste artigo?
}
