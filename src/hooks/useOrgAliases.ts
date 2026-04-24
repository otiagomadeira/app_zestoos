'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useOrgAliases() {
  const [aliases, setAliases] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('ingredient_aliases')
      .select('key, canonical_name')
      .then(({ data, error }) => {
        if (!error && data) setAliases(new Map(data.map(r => [r.key, r.canonical_name])))
        setLoading(false)
      })
  }, [])

  const learnAlias = useCallback(async (key: string, canonical: string) => {
    const supabase = createClient()
    const { error } = await supabase
      .from('ingredient_aliases')
      .upsert({ key, canonical_name: canonical }, { onConflict: 'key,organization_id' })
    if (!error) setAliases(prev => new Map(prev).set(key, canonical))
  }, [])

  const deleteAlias = useCallback(async (key: string) => {
    const supabase = createClient()
    const prev = new Map(aliases)
    setAliases(p => { const next = new Map(p); next.delete(key); return next })
    const { error } = await supabase.from('ingredient_aliases').delete().eq('key', key)
    if (error) setAliases(prev)
  }, [aliases])

  return { aliases, loading, learnAlias, deleteAlias }
}
