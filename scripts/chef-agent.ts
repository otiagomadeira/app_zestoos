/**
 * Zesto OS — Chef Agent
 * Autonomous testing agent that simulates a kitchen chef going through the full platform flow.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/chef-agent.ts
 *
 * Optionally pass --clean to delete all data created by a previous run first.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://hkpethoehojklwmnnfvh.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_P_IOFo_qMfv9pYQbJ9rn5A_aY2JOnGn'
const EMAIL    = 'tiagommcorreia@gmail.com'
const PASSWORD = 'teste1'

// ── Helpers ───────────────────────────────────────────────────

function truncate(s: string, n = 100) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

const ICONS: Record<string, string> = {
  info: 'ℹ️ ', success: '✅', warning: '⚠️ ', error: '❌'
}

// ── Tool definitions ──────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'report',
    description: 'Log an observation, progress update, or issue found while testing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        level:   { type: 'string', enum: ['info', 'success', 'warning', 'error'] },
        message: { type: 'string' }
      },
      required: ['level', 'message']
    }
  },
  {
    name: 'list_suppliers',
    description: 'List all active suppliers for the current organization.',
    input_schema: { type: 'object' as const, properties: {}, required: [] }
  },
  {
    name: 'create_supplier',
    description: 'Create a new supplier.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name:  { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        notes: { type: 'string' }
      },
      required: ['name']
    }
  },
  {
    name: 'list_articles',
    description: 'List all active articles (ingredients/products).',
    input_schema: { type: 'object' as const, properties: {}, required: [] }
  },
  {
    name: 'create_article',
    description: 'Create a new article (ingredient or product).',
    input_schema: {
      type: 'object' as const,
      properties: {
        name:      { type: 'string' },
        unit:      { type: 'string', description: 'Base unit: kg, L, un, etc.' },
        par_level: { type: 'number', description: 'Minimum stock level to maintain' },
        category:  { type: 'string' }
      },
      required: ['name', 'unit', 'par_level']
    }
  },
  {
    name: 'link_article_supplier',
    description: 'Link an article to a supplier with price and order unit.',
    input_schema: {
      type: 'object' as const,
      properties: {
        article_id:         { type: 'string' },
        supplier_id:        { type: 'string' },
        price:              { type: 'number', description: 'Price per order_unit (€)' },
        order_unit:         { type: 'string', description: 'Unit used when ordering (caixa, saco, fardo, kg…)' },
        conversion_factor:  { type: 'number', description: 'How many base units per order_unit (e.g. 1 caixa = 12 kg → 12)' },
        is_preferred:       { type: 'boolean' },
        supplier_ref:       { type: 'string' }
      },
      required: ['article_id', 'supplier_id', 'price', 'order_unit', 'conversion_factor']
    }
  },
  {
    name: 'list_stock',
    description: 'List current stock levels for all articles (from current_stock view).',
    input_schema: { type: 'object' as const, properties: {}, required: [] }
  },
  {
    name: 'adjust_stock',
    description: 'Record a stock movement (purchase, adjustment, consumption, waste).',
    input_schema: {
      type: 'object' as const,
      properties: {
        article_id: { type: 'string' },
        type:       { type: 'string', enum: ['PURCHASE', 'ADJUSTMENT', 'WASTE', 'CONSUMPTION'] },
        quantity:   { type: 'number', description: 'Positive = stock gain, negative = stock loss' },
        unit:       { type: 'string' },
        notes:      { type: 'string' }
      },
      required: ['article_id', 'type', 'quantity', 'unit']
    }
  },
  {
    name: 'list_order_suggestions',
    description: 'Get articles that are below par level and need to be ordered.',
    input_schema: { type: 'object' as const, properties: {}, required: [] }
  },
  {
    name: 'create_order',
    description: 'Create a new DRAFT order for a supplier.',
    input_schema: {
      type: 'object' as const,
      properties: {
        supplier_id: { type: 'string' },
        notes:       { type: 'string' }
      },
      required: ['supplier_id']
    }
  },
  {
    name: 'add_order_item',
    description: 'Add an item line to an existing order.',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id:            { type: 'string' },
        article_id:          { type: 'string' },
        quantity_ordered:    { type: 'number' },
        order_unit:          { type: 'string' },
        price_snapshot:      { type: 'number' },
        conversion_snapshot: { type: 'number' }
      },
      required: ['order_id', 'article_id', 'quantity_ordered', 'order_unit']
    }
  },
  {
    name: 'send_order',
    description: 'Mark a DRAFT order as SENT (submitted to supplier).',
    input_schema: {
      type: 'object' as const,
      properties: { order_id: { type: 'string' } },
      required: ['order_id']
    }
  },
  {
    name: 'receive_order',
    description: 'Mark an order as RECEIVED, record quantities received per item, and create PURCHASE stock movements.',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              order_item_id:     { type: 'string' },
              article_id:        { type: 'string' },
              quantity_received: { type: 'number' },
              order_unit:        { type: 'string' },
              conversion_factor: { type: 'number', description: 'To convert order_unit → base unit for stock movement' }
            },
            required: ['order_item_id', 'article_id', 'quantity_received', 'order_unit', 'conversion_factor']
          }
        }
      },
      required: ['order_id', 'items']
    }
  },
  {
    name: 'list_productions',
    description: 'List all active production recipes.',
    input_schema: { type: 'object' as const, properties: {}, required: [] }
  },
  {
    name: 'create_production',
    description: 'Create a new production recipe (technical sheet).',
    input_schema: {
      type: 'object' as const,
      properties: {
        name:        { type: 'string' },
        yield_qty:   { type: 'number', description: 'How much this recipe produces' },
        yield_unit:  { type: 'string', description: 'Unit of the yield (kg, L, doses, un…)' },
        notes:       { type: 'string' },
        preparation: { type: 'string', description: 'Free-text preparation steps' }
      },
      required: ['name', 'yield_qty', 'yield_unit']
    }
  },
  {
    name: 'add_production_ingredient',
    description: 'Add an ingredient to a production recipe.',
    input_schema: {
      type: 'object' as const,
      properties: {
        production_id: { type: 'string' },
        article_id:    { type: 'string' },
        quantity:      { type: 'number' },
        unit:          { type: 'string' },
        yield_factor:  { type: 'number', description: 'Efficiency 0–1 (e.g. 0.85 for 15% trim loss). Default 1.' },
        sort_order:    { type: 'number' }
      },
      required: ['production_id', 'article_id', 'quantity', 'unit']
    }
  }
]

// ── Tool execution ────────────────────────────────────────────

async function executeTool(
  sb: SupabaseClient,
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  switch (name) {

    case 'report': {
      const icon = ICONS[input.level as string] ?? '📝'
      console.log(`    ${icon} [${String(input.level).toUpperCase()}] ${input.message}`)
      return { ok: true }
    }

    case 'list_suppliers': {
      const { data, error } = await sb.from('suppliers').select('id, name, email, phone').eq('is_active', true)
      if (error) return { error: error.message }
      return { count: data.length, suppliers: data }
    }

    case 'create_supplier': {
      const { data, error } = await sb.from('suppliers').insert(input).select().single()
      if (error) return { error: error.message }
      return { supplier: data }
    }

    case 'list_articles': {
      const { data, error } = await sb.from('articles').select('id, name, unit, par_level, category').eq('is_active', true)
      if (error) return { error: error.message }
      return { count: data.length, articles: data }
    }

    case 'create_article': {
      const { data, error } = await sb.from('articles').insert(input).select().single()
      if (error) return { error: error.message }
      return { article: data }
    }

    case 'link_article_supplier': {
      const { data, error } = await sb.from('article_suppliers').insert(input).select().single()
      if (error) return { error: error.message }
      return { article_supplier: data }
    }

    case 'list_stock': {
      const { data, error } = await sb.from('current_stock').select('*')
      if (error) return { error: error.message }
      return { count: data.length, stock: data }
    }

    case 'adjust_stock': {
      const { data, error } = await sb.from('stock_movements').insert(input).select().single()
      if (error) return { error: error.message }
      return { movement: data }
    }

    case 'list_order_suggestions': {
      const { data, error } = await sb.from('order_suggestions').select('*')
      if (error) return { error: error.message }
      return { count: data.length, suggestions: data }
    }

    case 'create_order': {
      const { data, error } = await sb
        .from('orders')
        .insert({ ...input, status: 'DRAFT' })
        .select()
        .single()
      if (error) return { error: error.message }
      return { order: data }
    }

    case 'add_order_item': {
      const { data, error } = await sb.from('order_items').insert(input).select().single()
      if (error) return { error: error.message }
      return { order_item: data }
    }

    case 'send_order': {
      const { data, error } = await sb
        .from('orders')
        .update({ status: 'SENT', sent_at: new Date().toISOString() })
        .eq('id', input.order_id)
        .select()
        .single()
      if (error) return { error: error.message }
      return { order: data }
    }

    case 'receive_order': {
      const items = input.items as Array<{
        order_item_id: string
        article_id: string
        quantity_received: number
        order_unit: string
        conversion_factor: number
      }>

      // Update each order item with quantity received
      for (const item of items) {
        const { error } = await sb
          .from('order_items')
          .update({ quantity_received: item.quantity_received, received_at: new Date().toISOString() })
          .eq('id', item.order_item_id)
        if (error) return { error: `order_item ${item.order_item_id}: ${error.message}` }

        // Create PURCHASE stock movement (convert order_unit → base unit)
        const qtyInBaseUnit = item.quantity_received * item.conversion_factor
        const { error: mvErr } = await sb.from('stock_movements').insert({
          article_id: item.article_id,
          type: 'PURCHASE',
          quantity: qtyInBaseUnit,
          unit: item.order_unit, // store as-is; view aggregates in base unit
          notes: `Recebido: ${item.quantity_received} ${item.order_unit}`
        })
        if (mvErr) return { error: `stock movement for ${item.article_id}: ${mvErr.message}` }
      }

      // Mark order as RECEIVED
      const { data, error } = await sb
        .from('orders')
        .update({ status: 'RECEIVED', received_at: new Date().toISOString() })
        .eq('id', input.order_id)
        .select()
        .single()
      if (error) return { error: error.message }
      return { order: data, items_received: items.length }
    }

    case 'list_productions': {
      const { data, error } = await sb
        .from('productions')
        .select('id, name, yield_qty, yield_unit, notes')
        .eq('is_active', true)
      if (error) return { error: error.message }
      return { count: data.length, productions: data }
    }

    case 'create_production': {
      const { data, error } = await sb.from('productions').insert(input).select().single()
      if (error) return { error: error.message }
      return { production: data }
    }

    case 'add_production_ingredient': {
      const payload = { yield_factor: 1, sort_order: 0, ...input }
      const { data, error } = await sb.from('production_ingredients').insert(payload).select().single()
      if (error) return { error: error.message }
      return { ingredient: data }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌  ANTHROPIC_API_KEY não definida.')
    console.error('    Corre: ANTHROPIC_API_KEY=sk-... npx tsx scripts/chef-agent.ts')
    process.exit(1)
  }

  // Auth
  console.log('🔐 A autenticar no Supabase...')
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  })
  const { error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (authErr) {
    console.error('❌ Autenticação falhou:', authErr.message)
    process.exit(1)
  }
  console.log(`✅ Autenticado como ${EMAIL}\n`)

  const anthropic = new Anthropic()

  const system = `És o Chef António, chefe de cozinha da "Tasca do António", um restaurante português tradicional em Lisboa.
Estás a testar uma nova plataforma de gestão de cozinha chamada Zesto OS, fazendo tudo tu próprio como farias no dia-a-dia.

Testa o fluxo COMPLETO pela seguinte ordem:

1. **Verifica o que já existe** — fornecedores, artigos, stock atual
2. **Cria fornecedores** — 2-3 fornecedores portugueses realistas (frutas & legumes, carnes, mercearia)
3. **Cria artigos** — 12-15 ingredientes reais com unidades e par_level sensatos (bacalhau, chouriço, batatas, azeite, etc.)
4. **Liga artigos a fornecedores** — com preços e unidades de encomenda realistas (ex: 1 caixa = 10 kg)
5. **Define stock inicial** — usa ADJUSTMENT para meter stock de abertura em todos os artigos
6. **Simula consumo** — regista CONSUMPTION nos artigos mais usados para baixar stock
7. **Verifica sugestões de encomenda** — confirma que aparecem os artigos em falta
8. **Cria uma encomenda** — para pelo menos um fornecedor, com os itens sugeridos
9. **Envia a encomenda** — muda para SENT
10. **Recebe a encomenda** — regista as quantidades recebidas
11. **Cria receitas de produção** — pelo menos 2 (ex: Caldo Verde, Arroz de Frango) com ingredientes detalhados
12. **Relatório final** — usa report() para resumir o que testaste e qualquer problema encontrado

Usa 'report' regularmente para documentar o que fizeste e se funcionou.
Sê rigoroso: se uma operação falhar com erro, reporta-a como 'error'. Se algo parecer estranho no comportamento, reporta como 'warning'.
Usa nomes e valores portugueses e realistas em tudo.`

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: 'Começa os testes. Percorre o fluxo completo como um chef real.' }
  ]

  console.log('👨‍🍳 Chef António a iniciar testes...\n')
  console.log('─'.repeat(60))

  let iterations = 0
  const MAX = 60

  while (iterations < MAX) {
    iterations++

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system,
      tools: TOOLS,
      messages
    })

    // Print any text from the assistant
    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) {
        console.log(`\n🍳 ${block.text}`)
      }
    }

    if (response.stop_reason === 'end_turn') {
      console.log('\n' + '─'.repeat(60))
      console.log('✅ Chef agent terminou o ciclo de testes.')
      break
    }

    if (response.stop_reason !== 'tool_use') {
      console.log(`\nParagem inesperada: ${response.stop_reason}`)
      break
    }

    // Execute all tool calls
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    const toolResults: Anthropic.ToolResultBlockParam[] = []

    for (const tu of toolUses) {
      const inputStr = truncate(JSON.stringify(tu.input), 80)
      process.stdout.write(`  🔧 ${tu.name}(${inputStr}) `)

      const result = await executeTool(sb, tu.name, tu.input as Record<string, unknown>)
      const isError = typeof result === 'object' && result !== null && 'error' in result

      if (tu.name !== 'report') {
        // report() already printed its own line
        console.log(isError ? `❌ ${ (result as { error: string }).error}` : '✓')
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result)
      })
    }

    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user',      content: toolResults })
  }

  if (iterations >= MAX) {
    console.log('\n⚠️  Limite de iterações atingido.')
  }
}

main().catch((err) => {
  console.error('❌ Erro fatal:', err)
  process.exit(1)
})
