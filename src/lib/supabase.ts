import { createBrowserClient } from '@supabase/ssr'
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

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

// ── Stock ─────────────────────────────────────────────────────

// Variante de tamanho de embalagem de um artigo (tabela article_sizes)
export type ArticleSize = {
  label:         string   // notação original (ex: "200g", "1kg", "saco 5kg")
  base_per_unit: number   // base_units por unidade (ex: 200 para 200g)
}

/**
 * Devolve um Map de article_id → lista de tamanhos disponíveis para contagem.
 * Fonte: tabela article_sizes (independente de fornecedores).
 * Carregado uma vez com o inventário.
 */
export async function fetchAllArticleSizes(): Promise<Map<string, ArticleSize[]>> {
  const { data, error } = await supabase
    .from('article_sizes')
    .select('article_id, label, base_per_unit')
    .order('sort_order')

  if (error) throw error

  const map = new Map<string, ArticleSize[]>()
  for (const row of (data ?? []) as { article_id: string; label: string; base_per_unit: number }[]) {
    if (!map.has(row.article_id)) map.set(row.article_id, [])
    map.get(row.article_id)!.push({
      label:         row.label,
      base_per_unit: row.base_per_unit,
    })
  }
  return map
}

/**
 * Grava variantes de tamanho para um artigo.
 * Chamado após createArticle durante o bulk import.
 */
export async function saveArticleSizes(
  articleId: string,
  sizes: { label: string; base_per_unit: number; sort_order?: number }[],
): Promise<void> {
  if (sizes.length === 0) return
  const { error } = await supabase
    .from('article_sizes')
    .insert(sizes.map((s, i) => ({
      article_id:    articleId,
      label:         s.label,
      base_per_unit: s.base_per_unit,
      sort_order:    s.sort_order ?? i,
    })))
  if (error) throw error
}

export async function fetchCurrentStock(): Promise<CurrentStock[]> {
  const { data, error } = await supabase
    .from('current_stock')
    .select('*')
    .order('category', { ascending: true })
    .order('name',     { ascending: true })

  if (error) throw error
  return (data ?? []) as CurrentStock[]
}

export type CountComponent = {
  size_label:    string   // ex: "saco 200g" — label legível para auditoria
  qty:           number   // nº de unidades deste tamanho
  base_per_unit: number   // base_units por unidade (ex: 200g)
}

export async function saveStockCount(
  articleId:            string,
  newQtyStock:          number,       // total em stock_unit (usado para o notes)
  stockUnit:            string,       // unidade de stock (para o notes do movimento)
  components?:          CountComponent[],  // composição opcional (multi-tamanho)
  notes?:               string,
  knownCurrentQtyBase?: number,       // evita SELECT se caller já tem estes valores
  knownBaseUnit?:       string,
  knownBasePerStock?:   number,
): Promise<{ saved: boolean }> {
  // 1. Usa valores conhecidos do caller se disponíveis — evita SELECT redundante
  let basePerStock:   number
  let currentQtyBase: number
  let baseUnit:       string

  if (knownCurrentQtyBase !== undefined && knownBaseUnit !== undefined && knownBasePerStock !== undefined) {
    basePerStock   = knownBasePerStock
    currentQtyBase = knownCurrentQtyBase
    baseUnit       = knownBaseUnit
  } else {
    const { data: current, error: stockErr } = await supabase
      .from('current_stock')
      .select('current_qty_base, base_per_stock, unit')
      .eq('article_id', articleId)
      .single()
    if (stockErr) throw stockErr
    basePerStock   = current?.base_per_stock   ?? 1
    currentQtyBase = current?.current_qty_base ?? 0
    baseUnit       = current?.unit ?? stockUnit
  }

  // 2. Converter nova quantidade de stock_unit para base_unit
  //    Multi-tamanho: soma exata de (qty × base_per_unit) por componente
  //    Simples: newQtyStock × base_per_stock do fornecedor preferido
  const newQtyBase = components && components.length > 0
    ? components.reduce((sum, c) => sum + c.qty * c.base_per_unit, 0)
    : newQtyStock * basePerStock

  // 3. Delta em base_unit
  const deltaBase = newQtyBase - currentQtyBase

  // 4. Skip se não há mudança — devolve saved: false para feedback honesto
  if (Math.abs(deltaBase) < 0.0001) return { saved: false }

  // 5. Inserir ADJUSTMENT em base_unit (garante consistência histórica)
  const { data: movement, error: mvErr } = await supabase
    .from('stock_movements')
    .insert({
      article_id: articleId,
      type:       'ADJUSTMENT',
      quantity:   deltaBase,
      unit:       baseUnit,
      notes:      notes ?? `Contagem manual: ${newQtyStock} ${stockUnit}`,
      counted_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (mvErr) throw mvErr

  // 6. Inserir linhas de composição se fornecidas
  if (components && components.length > 0 && movement) {
    const { error: linesErr } = await supabase
      .from('stock_count_lines')
      .insert(
        components.map(c => ({
          movement_id:   movement.id,
          size_label:    c.size_label,
          qty:           c.qty,
          base_per_unit: c.base_per_unit,
          base_qty:      c.qty * c.base_per_unit,
        }))
      )
    if (linesErr) throw linesErr
  }

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
  // 1. Buscar itens da encomenda
  const { data: items, error: itemsErr } = await supabase
    .from('order_items')
    .select('id, article_id, quantity_ordered, order_unit')
    .eq('order_id', orderId)

  if (itemsErr) throw itemsErr
  if (!items || items.length === 0) return

  const articleIds = items.map((i: { article_id: string }) => i.article_id)

  // 2. Buscar info de stock atual (base_per_stock + unit)
  const { data: stocks, error: stockErr } = await supabase
    .from('current_stock')
    .select('article_id, base_per_stock, unit')
    .in('article_id', articleIds)

  if (stockErr) throw stockErr

  const stockMap = new Map(
    (stocks ?? []).map((s: { article_id: string; base_per_stock: number; unit: string }) =>
      [s.article_id, s]
    )
  )

  // 3. Buscar base_per_order_unit do fornecedor preferido
  const { data: suppliers, error: suppErr } = await supabase
    .from('article_suppliers')
    .select('article_id, base_per_order_unit, conversion_factor')
    .in('article_id', articleIds)
    .eq('is_preferred', true)

  if (suppErr) throw suppErr

  const supplierMap = new Map(
    (suppliers ?? []).map((s: { article_id: string; base_per_order_unit: number | null; conversion_factor: number }) =>
      [s.article_id, s]
    )
  )

  // 4. Criar movimentos de stock tipo PURCHASE
  const now = new Date().toISOString()
  const movements = (items as Array<{ id: string; article_id: string; quantity_ordered: number; order_unit: string }>)
    .map(item => {
      const stock    = stockMap.get(item.article_id)
      const supplier = supplierMap.get(item.article_id)
      const basePerOrderUnit =
        supplier?.base_per_order_unit ??
        (supplier?.conversion_factor ?? 1) * (stock?.base_per_stock ?? 1)
      return {
        article_id:    item.article_id,
        type:          'PURCHASE' as const,
        quantity:      item.quantity_ordered * basePerOrderUnit,
        unit:          stock?.unit ?? 'un',
        notes:         `Receção de encomenda`,
        order_item_id: item.id,
        counted_at:    now,
      }
    })

  const { error: mvErr } = await supabase.from('stock_movements').insert(movements)
  if (mvErr) throw mvErr

  // 5. Marcar itens como recebidos
  const itemIds = (items as Array<{ id: string }>).map(i => i.id)
  const { error: updateItemsErr } = await supabase
    .from('order_items')
    .update({ received_at: now })
    .in('id', itemIds)

  if (updateItemsErr) throw updateItemsErr

  // 6. Atualizar status da encomenda
  await updateOrderStatus(orderId, 'RECEIVED')
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

  // Build article price map for cost-per-line calc
  const articleIds = (ingRes.data ?? [])
    .filter((i: { article_id: string | null }) => i.article_id)
    .map((i: { article_id: string }) => i.article_id)

  const priceMap = new Map<string, number>()
  if (articleIds.length > 0) {
    const { data: suppliers } = await supabase
      .from('article_suppliers')
      .select('article_id, price, conversion_factor, base_per_order_unit')
      .in('article_id', articleIds)
      .eq('is_preferred', true)
    ;(suppliers ?? []).forEach((s: { article_id: string; price: number; conversion_factor: number; base_per_order_unit: number | null }) => {
      // custo por base_unit = price / base_per_order_unit (se configurado)
      // fallback: price / conversion_factor (comportamento anterior)
      const divisor = s.base_per_order_unit ?? s.conversion_factor
      priceMap.set(s.article_id, divisor > 0 ? s.price / divisor : 0)
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

  // Replace all ingredients
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

// Cache in module scope — loaded once per page session
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

/** Convert qty from fromUnit to toUnit. Returns null if no conversion exists. */
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
  name:        string
  unit:        string
  stock_unit?: string | null
  par_level:   number
  category?:   string
}): Promise<Article> {
  const { data, error } = await supabase
    .from('articles')
    .insert({
      name:       input.name,
      unit:       input.unit,
      stock_unit: input.stock_unit ?? null,
      par_level:  input.par_level,
      category:   input.category ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Article
}

export async function updateArticle(id: string, input: {
  name:        string
  unit:        string
  stock_unit?: string | null
  par_level:   number
  category?:   string
}): Promise<void> {
  const { error } = await supabase
    .from('articles')
    .update({
      name:       input.name,
      unit:       input.unit,
      stock_unit: input.stock_unit ?? null,
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
    supplier_id:          string
    supplier_ref?:        string | null
    price:                number
    order_unit:           string
    conversion_factor:    number
    base_per_order_unit?: number | null
    is_preferred:         boolean
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
        article_id:          articleId,
        supplier_id:         l.supplier_id,
        supplier_ref:        l.supplier_ref ?? null,
        price:               l.price,
        order_unit:          l.order_unit,
        conversion_factor:   l.conversion_factor,
        base_per_order_unit: l.base_per_order_unit ?? null,
        is_preferred:        l.is_preferred,
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
