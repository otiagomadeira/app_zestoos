'use client'

import { useState, useEffect, useCallback } from 'react'

type Persisted = {
  counted:   string[]
  skipped:   string[]
  updatedAt: string
}

/** Data local em formato yyyy-mm-dd (não UTC — sessão muda à meia-noite local). */
function todayLocalKey(): string {
  const d   = new Date()
  const y   = d.getFullYear()
  const m   = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function storageKey(orgId: string): string {
  return `inventorySession:${orgId}:${todayLocalKey()}`
}

type SessionState = {
  counted:  Set<string>
  skipped:  Set<string>
  hydrated: boolean
}

const EMPTY: SessionState = { counted: new Set(), skipped: new Set(), hydrated: false }

/**
 * Sessão de contagem de stock persistida em localStorage por organização e data.
 *
 * Chave: `inventorySession:{orgId}:{yyyy-mm-dd}` — sessão nova ao mudar dia local.
 * Estrutura: `{ counted: string[], skipped: string[], updatedAt: string }`.
 *
 * Nesta fase:
 *   - `counted` é alimentado pelo InventoryScreen quando saveStockCount tem sucesso
 *     (e quando o utilizador confirma "marcar como contado sem alterar")
 *   - `skipped` existe na estrutura para suportar A3 (botão "?" / saltar) sem
 *     migração futura — não é alimentado ainda
 *
 * Garantias:
 *   - SSR-safe: nada toca em window antes do useEffect
 *   - Defensivo: localStorage corrompido → começa limpo, não quebra UI
 *   - Quota cheia / private mode → estado em memória continua, persistência ignorada
 */

function readFromStorage(orgId: string | null): SessionState {
  if (!orgId || typeof window === 'undefined') return { ...EMPTY, hydrated: true }
  try {
    const raw = window.localStorage.getItem(storageKey(orgId))
    if (!raw) return { counted: new Set(), skipped: new Set(), hydrated: true }
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return {
      counted:  new Set(Array.isArray(parsed.counted) ? parsed.counted : []),
      skipped:  new Set(Array.isArray(parsed.skipped) ? parsed.skipped : []),
      hydrated: true,
    }
  } catch {
    return { counted: new Set(), skipped: new Set(), hydrated: true }
  }
}

export function useInventorySession(orgId: string | null) {
  const [state, setState] = useState<SessionState>(EMPTY)

  // Sync com localStorage quando orgId muda. Single setState evita cascading
  // renders — toda a leitura externa é resolvida em readFromStorage e aplicada
  // num único update por troca de chave (org ou data).
  useEffect(() => { setState(readFromStorage(orgId)) }, [orgId])

  const { counted, skipped, hydrated } = state

  const persist = useCallback((nextCounted: Set<string>, nextSkipped: Set<string>) => {
    if (!orgId || typeof window === 'undefined') return
    const payload: Persisted = {
      counted:   Array.from(nextCounted),
      skipped:   Array.from(nextSkipped),
      updatedAt: new Date().toISOString(),
    }
    try {
      window.localStorage.setItem(storageKey(orgId), JSON.stringify(payload))
    } catch {
      // quota / private mode — ignora; estado em memória mantém-se
    }
  }, [orgId])

  const addCounted = useCallback((id: string) => {
    setState(prev => {
      const alreadyCounted = prev.counted.has(id)
      const wasSkipped     = prev.skipped.has(id)
      if (alreadyCounted && !wasSkipped) return prev
      // contar promove um skip → counted (remove da lista de skipped)
      const nextCounted = alreadyCounted ? prev.counted : new Set(prev.counted).add(id)
      let nextSkipped = prev.skipped
      if (wasSkipped) { nextSkipped = new Set(prev.skipped); nextSkipped.delete(id) }
      persist(nextCounted, nextSkipped)
      return { counted: nextCounted, skipped: nextSkipped, hydrated: prev.hydrated }
    })
  }, [persist])

  const addSkipped = useCallback((id: string) => {
    setState(prev => {
      if (prev.skipped.has(id) || prev.counted.has(id)) return prev
      const nextSkipped = new Set(prev.skipped).add(id)
      persist(prev.counted, nextSkipped)
      return { counted: prev.counted, skipped: nextSkipped, hydrated: prev.hydrated }
    })
  }, [persist])

  return { counted, skipped, hydrated, addCounted, addSkipped }
}
