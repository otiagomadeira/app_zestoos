// ============================================================
// ZESTO OS — Database Types (mirrors Supabase schema)
// ============================================================

export type MovementType = 'PURCHASE' | 'ADJUSTMENT' | 'WASTE' | 'CONSUMPTION'
export type OrderStatus  = 'DRAFT' | 'SENT' | 'RECEIVED' | 'CANCELLED'

// ── Tables ──────────────────────────────────────────────────

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
  id:         string
  name:       string
  unit:       string
  par_level:  number
  category:   string | null
  is_active:  boolean
  created_at: string
  updated_at: string
}

export interface ArticleSupplier {
  id:                string
  article_id:        string
  supplier_id:       string
  supplier_ref:      string | null
  price:             number
  order_unit:        string
  conversion_factor: number
  is_preferred:      boolean
  created_at:        string
  updated_at:        string
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
  article_id:    string
  name:          string
  unit:          string
  par_level:     number
  category:      string | null
  current_qty:   number
  diff_from_par: number
}

export interface OrderSuggestion {
  article_id:            string
  name:                  string
  unit:                  string
  par_level:             number
  current_qty:           number
  diff_from_par:         number
  qty_to_order:          number
  supplier_id:           string | null
  supplier_name:         string | null
  order_unit:            string | null
  price:                 number | null
  conversion_factor:     number | null
  order_qty_in_order_unit: number | null
}

// ── UI Helpers ───────────────────────────────────────────────

export interface StockCountEntry {
  article_id: string
  name:       string
  unit:       string
  par_level:  number
  current_qty: number
  new_qty:    string   // the value being typed on the keypad
  dirty:      boolean  // has the user touched this?
}
