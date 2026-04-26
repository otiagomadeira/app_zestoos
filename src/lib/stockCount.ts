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
