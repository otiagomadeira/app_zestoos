'use client'

import { useState, useEffect, useCallback } from 'react'

type Persisted = {
  counted:   string[]
  skipped:   string[]
  sessionId: string
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

/**
 * Gera UUID v4 estável para identificar a sessão de contagem do dia.
 * Usa crypto.randomUUID quando disponível (Safari 15.4+, iOS 15.4+).
 * Fallback manual baseado em Math.random — só é usado em browsers muito
 * antigos; o resultado continua a ser um UUID v4 sintacticamente válido.
 */
function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

type SessionState = {
  counted:   Set<string>
  skipped:   Set<string>
  sessionId: string | null
  hydrated:  boolean
}

const EMPTY: SessionState = { counted: new Set(), skipped: new Set(), sessionId: null, hydrated: false }

/**
 * Sessão de contagem de stock persistida em localStorage por organização e data.
 *
 * Chave: `inventorySession:{orgId}:{yyyy-mm-dd}` — sessão nova ao mudar dia local.
 * Estrutura: `{ counted: string[], skipped: string[], sessionId: uuid, updatedAt: string }`.
 *
 * Nesta fase:
 *   - `counted` é alimentado pelo InventoryScreen quando saveStockCount tem sucesso
 *     (e quando o utilizador confirma "marcar como contado sem alterar")
 *   - `skipped` existe na estrutura para suportar A3 (botão "?" / saltar) sem
 *     migração futura — não é alimentado ainda
 *   - `sessionId` identifica a sessão de contagem do dia. É a chave de
 *     idempotência usada por record_stock_count_inline (Fase C1.1) — múltiplos
 *     autosaves no mesmo artigo dentro da mesma sessão fazem UPDATE in-place.
 *     Reutilizado enquanto for o mesmo dia local; novo dia → novo sessionId.
 *
 * Garantias:
 *   - SSR-safe: nada toca em window/crypto antes do useEffect
 *   - Defensivo: localStorage corrompido → começa limpo, não quebra UI
 *   - Quota cheia / private mode → estado em memória continua, persistência ignorada
 *   - Backwards compatible: payload antigo sem sessionId é hidratado e migrado
 *     para incluir sessionId no próximo persist
 */

function readFromStorage(orgId: string | null): SessionState {
  if (!orgId || typeof window === 'undefined') return { ...EMPTY, hydrated: true }
  try {
    const raw = window.localStorage.getItem(storageKey(orgId))
    if (!raw) {
      return {
        counted:   new Set(),
        skipped:   new Set(),
        sessionId: generateSessionId(),
        hydrated:  true,
      }
    }
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return {
      counted:   new Set(Array.isArray(parsed.counted) ? parsed.counted : []),
      skipped:   new Set(Array.isArray(parsed.skipped) ? parsed.skipped : []),
      sessionId: typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0
        ? parsed.sessionId
        : generateSessionId(),
      hydrated:  true,
    }
  } catch {
    return {
      counted:   new Set(),
      skipped:   new Set(),
      sessionId: generateSessionId(),
      hydrated:  true,
    }
  }
}

export function useInventorySession(orgId: string | null) {
  const [state, setState] = useState<SessionState>(EMPTY)

  // Sync com localStorage quando orgId muda. Single setState evita cascading
  // renders — toda a leitura externa é resolvida em readFromStorage e aplicada
  // num único update por troca de chave (org ou data).
  useEffect(() => { setState(readFromStorage(orgId)) }, [orgId])

  const { counted, skipped, sessionId, hydrated } = state

  const persist = useCallback((nextCounted: Set<string>, nextSkipped: Set<string>, sid: string | null) => {
    if (!orgId || typeof window === 'undefined' || !sid) return
    const payload: Persisted = {
      counted:   Array.from(nextCounted),
      skipped:   Array.from(nextSkipped),
      sessionId: sid,
      updatedAt: new Date().toISOString(),
    }
    try {
      window.localStorage.setItem(storageKey(orgId), JSON.stringify(payload))
    } catch {
      // quota / private mode — ignora; estado em memória mantém-se
    }
  }, [orgId])

  // Após hidratação, garante que o sessionId fica persistido (caso o payload
  // antigo não tivesse sessionId, ou o storage estivesse vazio antes).
  useEffect(() => {
    if (!hydrated || !sessionId) return
    persist(state.counted, state.skipped, sessionId)
    // Só corre quando sessionId é definido pela primeira vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, sessionId])

  const addCounted = useCallback((id: string) => {
    setState(prev => {
      const alreadyCounted = prev.counted.has(id)
      const wasSkipped     = prev.skipped.has(id)
      if (alreadyCounted && !wasSkipped) return prev
      // contar promove um skip → counted (remove da lista de skipped)
      const nextCounted = alreadyCounted ? prev.counted : new Set(prev.counted).add(id)
      let nextSkipped = prev.skipped
      if (wasSkipped) { nextSkipped = new Set(prev.skipped); nextSkipped.delete(id) }
      persist(nextCounted, nextSkipped, prev.sessionId)
      return { ...prev, counted: nextCounted, skipped: nextSkipped }
    })
  }, [persist])

  const addSkipped = useCallback((id: string) => {
    setState(prev => {
      const alreadySkipped = prev.skipped.has(id)
      const wasCounted     = prev.counted.has(id)
      if (alreadySkipped && !wasCounted) return prev
      // saltar promove um counted → skipped (remove da lista de counted)
      const nextSkipped = alreadySkipped ? prev.skipped : new Set(prev.skipped).add(id)
      let nextCounted = prev.counted
      if (wasCounted) { nextCounted = new Set(prev.counted); nextCounted.delete(id) }
      persist(nextCounted, nextSkipped, prev.sessionId)
      return { ...prev, counted: nextCounted, skipped: nextSkipped }
    })
  }, [persist])

  return { counted, skipped, sessionId, hydrated, addCounted, addSkipped }
}
