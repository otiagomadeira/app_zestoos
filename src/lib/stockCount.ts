'use client'

import { supabase } from '@/lib/supabase'
import { invalidateCache } from '@/lib/cache'

export type Packaging = {
  label:         string
  base_per_unit: number
  source:        'size' | 'supplier' | 'fallback'
  sort_key:      number
}

export type CountLine = {
  label:         string
  qty:           number
  base_per_unit: number
}

// Chave estável por linha de embalagem: dois suppliers podem usar a mesma
// label com base_per_unit diferente (saco 5kg vs saco 25kg) — o par é único.
export function packagingKey(p: { label: string; base_per_unit: number }): string {
  return `${p.label.toLowerCase()}|${p.base_per_unit}`
}

export async function fetchPackagings(articleId: string): Promise<Packaging[]> {
  const { data, error } = await supabase.rpc('article_packagings', {
    p_article_id: articleId,
  })
  if (error) throw error
  return (data ?? []).map((r: { label: string; base_per_unit: string | number; source: string; sort_key: number }) => ({
    label:         r.label,
    base_per_unit: Number(r.base_per_unit),
    source:        r.source as Packaging['source'],
    sort_key:      r.sort_key,
  }))
}

export async function recordStockCount(
  articleId: string,
  lines:     CountLine[],
): Promise<{ saved: boolean; movementId: string | null }> {
  const { data, error } = await supabase.rpc('record_stock_count', {
    p_article_id: articleId,
    p_lines:      lines.map(l => ({
      label:         l.label,
      qty:           l.qty,
      base_per_unit: l.base_per_unit,
    })),
  })
  if (error) throw error
  const movementId = (data as string | null) ?? null
  if (movementId) invalidateCache('current_stock', 'order_suggestions')
  return { saved: movementId !== null, movementId }
}

// Autosave inline para artigos single-packaging (Fase C1).
//
// Idempotente por (article_id, count_session_id): chamadas repetidas dentro
// da mesma sessão fazem UPDATE in-place no mesmo stock_movement em vez de
// criar novos. O RPC trata internamente race conditions (apanha
// unique_violation, faz re-fetch + UPDATE) — cliente não precisa retry.
//
// "saved" é sempre true quando não há erro, mesmo que movementId seja null
// (caso no-op: delta zero e sem movement existente). Isto permite ao card
// marcar o artigo como contado mesmo quando a contagem coincide com o stock
// já registado (ex: chef confirma 0 num artigo a zero).
export async function recordStockCountInline(
  articleId: string,
  qty:       number,
  sessionId: string,
): Promise<{ saved: boolean; movementId: string | null }> {
  const { data, error } = await supabase.rpc('record_stock_count_inline', {
    p_article_id: articleId,
    p_qty:        qty,
    p_session_id: sessionId,
  })
  if (error) throw error
  const movementId = (data as string | null) ?? null
  if (movementId) invalidateCache('current_stock', 'order_suggestions')
  return { saved: true, movementId }
}
