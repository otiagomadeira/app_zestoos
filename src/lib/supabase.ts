import { createClient } from '@supabase/supabase-js'
import type { CurrentStock, OrderSuggestion, StockMovement } from '@/types/database'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ''
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export const supabase = createClient(supabaseUrl, supabaseAnon)

// ── Stock ─────────────────────────────────────────────────────

export async function fetchCurrentStock(): Promise<CurrentStock[]> {
  const { data, error } = await supabase
    .from('current_stock')
    .select('*')
    .order('category', { ascending: true })
    .order('name',     { ascending: true })

  if (error) throw error
  return (data ?? []) as CurrentStock[]
}

export async function saveStockCount(
  articleId: string,
  newQty:    number,
  unit:      string,
  notes?:    string,
): Promise<void> {
  // 1. Get current calculated stock
  const { data: current, error: stockErr } = await supabase
    .from('current_stock')
    .select('current_qty')
    .eq('article_id', articleId)
    .single()

  if (stockErr) throw stockErr

  const delta = newQty - (current?.current_qty ?? 0)

  // 2. Insert ADJUSTMENT movement for the delta
  const { error: mvErr } = await supabase
    .from('stock_movements')
    .insert({
      article_id: articleId,
      type:       'ADJUSTMENT',
      quantity:   delta,
      unit,
      notes:      notes ?? `Contagem manual: ${newQty} ${unit}`,
      counted_at: new Date().toISOString(),
    })

  if (mvErr) throw mvErr
}

// ── Order Suggestions ─────────────────────────────────────────

export async function fetchOrderSuggestions(): Promise<OrderSuggestion[]> {
  const { data, error } = await supabase
    .from('order_suggestions')
    .select('*')
    .order('name', { ascending: true })

  if (error) throw error
  return (data ?? []) as OrderSuggestion[]
}

// ── Movements ─────────────────────────────────────────────────

export async function fetchRecentMovements(
  articleId: string,
  limit = 10,
): Promise<StockMovement[]> {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*')
    .eq('article_id', articleId)
    .order('counted_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as StockMovement[]
}
