import { createClient } from '@/lib/supabase/client'
import type {
  Article,
  ArticleSupplier,
  CurrentStock,
  CurrentProductionStock,
  IngredientDetail,
  OrderSuggestion,
  Production,
  ProductionDetail,
  ProductionWithCost,
  StockMovement,
  Supplier,
} from '@/types/database'

export const supabase = createClient()

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
  articleId:   string,
  newQty:      number,   // novo nível de stock em base_unit (article.unit)
  unit:        string,   // article.unit — para notas do movimento
  currentQty?: number,   // optimização: evita SELECT se o caller já tem o valor
): Promise<{ saved: boolean }> {
  let currentQtyBase: number

  if (currentQty !== undefined) {
    currentQtyBase = currentQty
  } else {
    const { data, error } = await supabase
      .from('current_stock')
      .select('current_qty')
      .eq('article_id', articleId)
      .single()
    if (error) throw error
    currentQtyBase = (data as { current_qty: number } | null)?.current_qty ?? 0
  }

  const delta = newQty - currentQtyBase
  if (Math.abs(delta) < 0.0001) return { saved: false }

  const { error } = await supabase
    .from('stock_movements')
    .insert({
      article_id: articleId,
      type:       'ADJUSTMENT',
      quantity:   delta,
      unit,
      notes:      `Contagem manual: ${newQty} ${unit}`,
      counted_at: new Date().toISOString(),
    })
  if (error) throw error

  return { saved: true }
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

// ── Orders ────────────────────────────────────────────────────

export interface OrderItemDetail {
  id:               string
  article_id:       string
  article_name:     string
  quantity_ordered: number
  order_unit:       string
}

export interface OrderWithDetails {
  id:            string
  status:        'DRAFT' | 'SENT' | 'RECEIVED' | 'CANCELLED'
  notes:         string | null
  sent_at:       string | null
  received_at:   string | null
  created_at:    string
  supplier_id:   string
  supplier_name: string
  items:         OrderItemDetail[]
}

export async function fetchActiveOrders(): Promise<OrderWithDetails[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      id, status, notes, sent_at, received_at, created_at, supplier_id,
      suppliers(name),
      order_items(
        id, article_id, quantity_ordered, order_unit,
        articles(name)
      )
    `)
    .in('status', ['DRAFT', 'SENT'])
    .order('created_at', { ascending: false })

  if (error) throw error

  return ((data ?? []) as unknown[]).map((row: unknown) => {
    const r = row as {
      id: string; status: string; notes: string | null;
      sent_at: string | null; received_at: string | null;
      created_at: string; supplier_id: string;
      suppliers: { name: string } | null;
      order_items: Array<{
        id: string; article_id: string; quantity_ordered: number;
        order_unit: string; articles: { name: string } | null;
      }> | null;
    }
    return {
      id:            r.id,
      status:        r.status as OrderWithDetails['status'],
      notes:         r.notes,
      sent_at:       r.sent_at,
      received_at:   r.received_at,
      created_at:    r.created_at,
      supplier_id:   r.supplier_id,
      supplier_name: r.suppliers?.name ?? 'Fornecedor desconhecido',
      items:         (r.order_items ?? []).map(i => ({
        id:               i.id,
        article_id:       i.article_id,
        article_name:     i.articles?.name ?? i.article_id,
        quantity_ordered: i.quantity_ordered,
        order_unit:       i.order_unit,
      })),
    }
  })
}

export async function updateOrderStatus(
  orderId: string,
  status:  'DRAFT' | 'SENT' | 'RECEIVED' | 'CANCELLED',
): Promise<void> {
  const updates: Record<string, unknown> = { status }
  if (status === 'SENT')     updates.sent_at     = new Date().toISOString()
  if (status === 'RECEIVED') updates.received_at = new Date().toISOString()

  const { error } = await supabase
    .from('orders')
    .update(updates)
    .eq('id', orderId)

  if (error) throw error
}

export async function receiveOrder(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('receive_order', { p_order_id: orderId })
  if (error) throw error
}

// ── Articles (para selectors) ────────────────────────────────

export async function fetchArticles(): Promise<Article[]> {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) throw error
  return (data ?? []) as Article[]
}

// ── Productions ───────────────────────────────────────────────

export async function fetchProductionsWithStock(): Promise<(CurrentProductionStock & Partial<ProductionWithCost>)[]> {
  const [stockRes, costRes] = await Promise.all([
    supabase.from('current_production_stock').select('*').order('name', { ascending: true }),
    supabase.from('production_cost').select('*'),
  ])

  if (stockRes.error) throw stockRes.error

  const costMap = new Map<string, ProductionWithCost>()
  ;(costRes.data ?? []).forEach((c: ProductionWithCost) => costMap.set(c.production_id, c))

  return (stockRes.data ?? []).map((s: CurrentProductionStock) => ({
    ...s,
    ...costMap.get(s.production_id),
  }))
}

export async function fetchProductionDetail(id: string): Promise<ProductionDetail> {
  const [prodRes, ingRes, costRes, stockRes] = await Promise.all([
    supabase.from('productions').select('*').eq('id', id).single(),
    supabase
      .from('production_ingredients')
      .select('*, articles(id,name,unit), productions!sub_production_id(id,name,yield_unit)')
      .eq('production_id', id)
      .order('sort_order', { ascending: true }),
    supabase.from('production_cost').select('*').eq('production_id', id).maybeSingle(),
    supabase.from('current_production_stock').select('*').eq('production_id', id).maybeSingle(),
  ])

  if (prodRes.error) throw prodRes.error

  const articleIds = (ingRes.data ?? [])
    .filter((i: { article_id: string | null }) => i.article_id)
    .map((i: { article_id: string }) => i.article_id)

  const priceMap = new Map<string, number>()
  if (articleIds.length > 0) {
    const { data: suppliers } = await supabase
      .from('article_suppliers')
      .select('article_id, price, conversion_factor')
      .in('article_id', articleIds)
      .eq('is_preferred', true)
    ;(suppliers ?? []).forEach((s: { article_id: string; price: number; conversion_factor: number }) => {
      priceMap.set(s.article_id, s.conversion_factor > 0 ? s.price / s.conversion_factor : 0)
    })
  }

  const ingredients: IngredientDetail[] = (ingRes.data ?? []).map((i: {
    id: string
    production_id: string
    article_id: string | null
    sub_production_id: string | null
    quantity: number
    unit: string
    yield_factor: number
    sort_order: number
    created_at: string
    articles?: { id: string; name: string; unit: string } | null
    productions?: { id: string; name: string; yield_unit: string } | null
  }) => {
    const unitCost = i.article_id ? (priceMap.get(i.article_id) ?? 0) : 0
    const lineCost = (i.quantity / i.yield_factor) * unitCost
    return {
      id:                   i.id,
      production_id:        i.production_id,
      article_id:           i.article_id,
      sub_production_id:    i.sub_production_id,
      quantity:             i.quantity,
      unit:                 i.unit,
      yield_factor:         i.yield_factor,
      sort_order:           i.sort_order,
      created_at:           i.created_at,
      article_name:         i.articles?.name,
      sub_production_name:  i.productions?.name,
      unit_cost:            unitCost,
      line_cost:            lineCost,
    }
  })

  return {
    ...prodRes.data,
    ingredients,
    total_cost:    costRes.data?.total_cost    ?? 0,
    cost_per_unit: costRes.data?.cost_per_unit ?? 0,
    current_qty:   stockRes.data?.current_qty  ?? 0,
  } as ProductionDetail
}

export async function fetchProductionsList(): Promise<Production[]> {
  const { data, error } = await supabase
    .from('productions')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Production[]
}

type ProductionInput = {
  name:        string
  yield_qty:   number
  yield_unit:  string
  notes?:      string
  preparation?: string
  ingredients: Array<{
    article_id?:        string
    sub_production_id?: string
    quantity:           number
    unit:               string
    yield_factor:       number
    sort_order:         number
  }>
}

export async function createProduction(input: ProductionInput): Promise<Production> {
  const { data: prod, error: prodErr } = await supabase
    .from('productions')
    .insert({
      name:        input.name,
      yield_qty:   input.yield_qty,
      yield_unit:  input.yield_unit,
      notes:       input.notes       ?? null,
      preparation: input.preparation ?? null,
    })
    .select()
    .single()

  if (prodErr) throw prodErr

  if (input.ingredients.length > 0) {
    const { error: ingErr } = await supabase
      .from('production_ingredients')
      .insert(
        input.ingredients.map(i => ({
          production_id:     prod.id,
          article_id:        i.article_id        ?? null,
          sub_production_id: i.sub_production_id ?? null,
          quantity:          i.quantity,
          unit:              i.unit,
          yield_factor:      i.yield_factor,
          sort_order:        i.sort_order,
        }))
      )
    if (ingErr) throw ingErr
  }

  return prod as Production
}

export async function updateProduction(id: string, input: ProductionInput): Promise<void> {
  const { error: prodErr } = await supabase
    .from('productions')
    .update({
      name:        input.name,
      yield_qty:   input.yield_qty,
      yield_unit:  input.yield_unit,
      notes:       input.notes       ?? null,
      preparation: input.preparation ?? null,
      updated_at:  new Date().toISOString(),
    })
    .eq('id', id)

  if (prodErr) throw prodErr

  const { error: delErr } = await supabase
    .from('production_ingredients')
    .delete()
    .eq('production_id', id)

  if (delErr) throw delErr

  if (input.ingredients.length > 0) {
    const { error: ingErr } = await supabase
      .from('production_ingredients')
      .insert(
        input.ingredients.map(i => ({
          production_id:     id,
          article_id:        i.article_id        ?? null,
          sub_production_id: i.sub_production_id ?? null,
          quantity:          i.quantity,
          unit:              i.unit,
          yield_factor:      i.yield_factor,
          sort_order:        i.sort_order,
        }))
      )
    if (ingErr) throw ingErr
  }
}

export async function saveProductionCount(
  productionId: string,
  qty:          number,
  unit:         string,
  notes?:       string,
): Promise<void> {
  const { error } = await supabase
    .from('production_stock')
    .insert({
      production_id: productionId,
      quantity:      qty,
      unit,
      notes:         notes ?? `Contagem manual: ${qty} ${unit}`,
      counted_at:    new Date().toISOString(),
    })
  if (error) throw error
}

// ── Unit Conversions ──────────────────────────────────────────

let _conversionCache: Map<string, Map<string, number>> | null = null

export async function fetchUnitConversions(): Promise<Map<string, Map<string, number>>> {
  if (_conversionCache) return _conversionCache

  const { data, error } = await supabase
    .from('unit_conversions')
    .select('from_unit, to_unit, factor')

  if (error) throw error

  const map = new Map<string, Map<string, number>>()
  for (const row of (data ?? []) as { from_unit: string; to_unit: string; factor: number }[]) {
    if (!map.has(row.from_unit)) map.set(row.from_unit, new Map())
    map.get(row.from_unit)!.set(row.to_unit, row.factor)
  }

  _conversionCache = map
  return map
}

export function convertUnit(
  qty:         number,
  fromUnit:    string,
  toUnit:      string,
  conversions: Map<string, Map<string, number>>,
): number | null {
  if (fromUnit === toUnit) return qty
  const factor = conversions.get(fromUnit)?.get(toUnit)
  if (factor == null) return null
  return qty * factor
}

// ── Articles Management ───────────────────────────────────────

export async function fetchAllArticles(): Promise<Article[]> {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Article[]
}

export async function createArticle(input: {
  name:      string
  unit:      string
  par_level: number
  category?: string
}): Promise<Article> {
  const { data, error } = await supabase
    .from('articles')
    .insert({
      name:      input.name,
      unit:      input.unit,
      par_level: input.par_level,
      category:  input.category ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Article
}

export async function updateArticle(id: string, input: {
  name:      string
  unit:      string
  par_level: number
  category?: string
}): Promise<void> {
  const { error } = await supabase
    .from('articles')
    .update({
      name:       input.name,
      unit:       input.unit,
      par_level:  input.par_level,
      category:   input.category ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

export async function toggleArticleActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('articles')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function fetchArticleSuppliers(
  articleId: string,
): Promise<(ArticleSupplier & { supplier_name: string })[]> {
  const { data, error } = await supabase
    .from('article_suppliers')
    .select('*, suppliers(name)')
    .eq('article_id', articleId)
    .order('is_preferred', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row: ArticleSupplier & { suppliers?: { name: string } | null }) => ({
    ...row,
    supplier_name: row.suppliers?.name ?? '',
  }))
}

export async function saveArticleSuppliers(
  articleId: string,
  links: Array<{
    supplier_id:       string
    supplier_ref?:     string | null
    price:             number
    order_unit:        string
    conversion_factor: number
    is_preferred:      boolean
  }>,
): Promise<void> {
  const { error: delErr } = await supabase
    .from('article_suppliers')
    .delete()
    .eq('article_id', articleId)
  if (delErr) throw delErr

  if (links.length > 0) {
    const { error: insErr } = await supabase
      .from('article_suppliers')
      .insert(links.map(l => ({
        article_id:        articleId,
        supplier_id:       l.supplier_id,
        supplier_ref:      l.supplier_ref ?? null,
        price:             l.price,
        order_unit:        l.order_unit,
        conversion_factor: l.conversion_factor,
        is_preferred:      l.is_preferred,
      })))
    if (insErr) throw insErr
  }
}

// ── Suppliers Management ──────────────────────────────────────

export async function fetchAllSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Supplier[]
}

export async function createSupplier(input: {
  name:   string
  phone?: string
  email?: string
  notes?: string
}): Promise<Supplier> {
  const { data, error } = await supabase
    .from('suppliers')
    .insert({
      name:  input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Supplier
}

export async function updateSupplier(id: string, input: {
  name:   string
  phone?: string
  email?: string
  notes?: string
}): Promise<void> {
  const { error } = await supabase
    .from('suppliers')
    .update({
      name:       input.name,
      phone:      input.phone ?? null,
      email:      input.email ?? null,
      notes:      input.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

export async function toggleSupplierActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('suppliers')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
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
