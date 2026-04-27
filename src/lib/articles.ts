/**
 * Helpers de cliente para tabelas relacionadas com artigos.
 *
 * Não usar `src/lib/supabase.ts` para novas funções (ficheiro legado).
 * Este módulo segue o pattern client/server separado: usa o browser client
 * (`@/lib/supabase/client`) e nunca passa `organization_id` — o RLS isola
 * via `current_org_id()` e o trigger `set_organization_id` injecta em INSERT.
 */

import { createClient } from '@/lib/supabase/client'
import type { ArticleSize } from '@/types/database'

/**
 * Lê os article_sizes de um artigo, ordenados por sort_order ascendente.
 *
 * Usado pelo ArticleForm em edição: se existir um size, é a fonte estável
 * da unidade visual do par_level (label + base_per_unit). Sobrepõe-se ao
 * fornecedor preferido como fonte — ver design doc 2026-04-27-article-intent.
 *
 * Falha silenciosa: retorna [] em caso de erro. Nunca bloqueia o load do form.
 */
export async function fetchArticleSizes(articleId: string): Promise<ArticleSize[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('article_sizes')
    .select('id, article_id, label, base_per_unit, sort_order, created_at')
    .eq('article_id', articleId)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('fetchArticleSizes:', error)
    return []
  }
  return (data ?? []) as ArticleSize[]
}
