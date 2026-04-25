'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Devolve o organization_id do utilizador autenticado, ou null enquanto
 * carrega. Usa o RLS de `profiles` (policy `own_profile`: id = auth.uid())
 * para devolver apenas a linha do utilizador atual.
 *
 * Caching: useState dentro do componente — cada montagem faz 1 fetch.
 * Suficiente para B1 (Inventário). Se mais ecrãs precisarem, promover a
 * Context provider em AppShell.
 */
export function useCurrentOrgId(): string | null {
  const [orgId, setOrgId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('profiles')
      .select('organization_id')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.organization_id) setOrgId(data.organization_id)
      })
  }, [])

  return orgId
}
