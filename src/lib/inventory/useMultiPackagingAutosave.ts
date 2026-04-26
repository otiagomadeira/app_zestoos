'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { recordStockCountMultiInline } from '@/lib/stockCount'
import type { Packaging, CountLine } from '@/lib/stockCount'
import { packagingKey } from '@/lib/stockCount'

export type MultiAutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface UseMultiPackagingAutosaveOptions {
  articleId:   string
  sessionId:   string | null
  packagings:  Packaging[] | null
  onSaved?:    () => void
  debounceMs?: number
}

export interface UseMultiPackagingAutosave {
  qtys:    Record<string, string>     // key = packagingKey(p) → string com vírgula PT
  status:  MultiAutosaveStatus
  error:   string | null
  setQty:  (key: string, raw: string) => void
  step:    (key: string, base_per_unit: number, label: string, delta: number) => void
  flush:   () => Promise<void>
  retry:   () => Promise<void>
  total:   number                     // soma em base_unit (para display da linha "Total")
  hasAny:  boolean                    // true se pelo menos um qty > 0 (controla visibilidade do Total)
}

const DEFAULT_DEBOUNCE = 1500
const SAVED_DISPLAY_MS = 2000

function pendingKey(sessionId: string, articleId: string): string {
  return `zesto.inventory.pending.multi.${sessionId}.${articleId}`
}

function sanitize(raw: string): string {
  return raw.replace(',', '.').replace(/[^\d.]/g, '').slice(0, 8)
}

function parseQty(qty: string): number {
  const trimmed = qty.trim()
  if (trimmed === '' || trimmed === '.') return 0
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return NaN
  return n
}

// String → display em vírgula PT, integer sem decimais.
function fmtForDisplay(n: number): string {
  if (Math.abs(n) < 0.0001) return ''
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',')
}

/**
 * Hook de autosave para artigos multi-embalagem (Fase C2).
 *
 * Espelha useArticleAutosave mas com state Record<key, string> (uma qty por
 * embalagem) e gravação via recordStockCountMultiInline (RPC idempotente
 * por session_id, mesmo padrão do inline).
 *
 * Comportamento:
 *   - `setQty(key, raw)` actualiza imediatamente o valor local, marca dirty,
 *     persiste backup em localStorage e agenda flush via debounce (1500ms).
 *   - `step(key, base_per_unit, label, delta)` ajusta a qty por delta com clamp >= 0.
 *     Inclui o label/base_per_unit para preencher entries em falta no state.
 *   - `flush()` cancela debounce e dispara save imediato.
 *   - Em sucesso: limpa backup, dispara onSaved, transita saving → saved → idle.
 *   - Em erro: status error persiste; setQty ou retry reentram.
 *
 * Tolerância a falhas: igual ao inline. localStorage backup por (sessionId,
 * articleId), best-effort flush em visibilitychange/pagehide.
 *
 * O cliente passa as packagings (do article_packagings RPC). Quando packagings
 * muda (raro durante uma sessão), o estado é preservado por chave; chaves
 * obsoletas são silenciosamente ignoradas no save.
 */
export function useMultiPackagingAutosave({
  articleId,
  sessionId,
  packagings,
  onSaved,
  debounceMs = DEFAULT_DEBOUNCE,
}: UseMultiPackagingAutosaveOptions): UseMultiPackagingAutosave {
  const [qtys,   setQtysState] = useState<Record<string, string>>({})
  const [status, setStatus]    = useState<MultiAutosaveStatus>('idle')
  const [error,  setError]     = useState<string | null>(null)

  const debounceRef       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef       = useRef<boolean>(false)
  const pendingValueRef   = useRef<Record<string, string> | null>(null)
  const latestQtysRef     = useRef<Record<string, string>>({})
  const onSavedRef        = useRef<typeof onSaved>(onSaved)
  const hydratedBackupRef = useRef<boolean>(false)
  const packagingsRef     = useRef<Packaging[] | null>(packagings)

  useEffect(() => { onSavedRef.current    = onSaved   }, [onSaved])
  useEffect(() => { latestQtysRef.current = qtys      }, [qtys])
  useEffect(() => { packagingsRef.current = packagings }, [packagings])

  const clearPendingBackup = useCallback(() => {
    if (!sessionId || typeof window === 'undefined') return
    try {
      window.localStorage.removeItem(pendingKey(sessionId, articleId))
    } catch { /* ignore */ }
  }, [sessionId, articleId])

  const writePendingBackup = useCallback((next: Record<string, string>) => {
    if (!sessionId || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(
        pendingKey(sessionId, articleId),
        JSON.stringify({ qtys: next, ts: Date.now() })
      )
    } catch { /* ignore */ }
  }, [sessionId, articleId])

  // Constrói as CountLine[] a partir das qtys actuais + packagings disponíveis.
  // Filtra só as que têm packaging match (defensivo contra qtys obsoletas).
  const buildLines = useCallback((from: Record<string, string>): CountLine[] => {
    const pkgs = packagingsRef.current
    if (!pkgs) return []
    const out: CountLine[] = []
    for (const p of pkgs) {
      const key = packagingKey(p)
      const raw = from[key] ?? ''
      const n   = parseQty(raw)
      if (!Number.isFinite(n)) continue          // sintaxe inválida → pula linha
      if (n <= 0) continue                        // 0 → não envia (RPC also filtra)
      out.push({ label: p.label, qty: n, base_per_unit: p.base_per_unit })
    }
    return out
  }, [])

  const performSave = useCallback(async (snapshot: Record<string, string>): Promise<void> => {
    if (!sessionId) return

    // Validação: alguma qty inválida → status error (não chamar RPC)
    const pkgs = packagingsRef.current ?? []
    for (const p of pkgs) {
      const key = packagingKey(p)
      const raw = snapshot[key]
      if (raw === undefined || raw === '') continue
      const n = parseQty(raw)
      if (!Number.isFinite(n)) {
        setStatus('error')
        setError('Quantidade inválida')
        return
      }
    }

    const lines = buildLines(snapshot)

    inFlightRef.current = true
    setStatus('saving')
    setError(null)

    try {
      let attempts = 0
      for (;;) {
        try {
          await recordStockCountMultiInline(articleId, lines, sessionId)
          break
        } catch (e) {
          const msg = (e as Error)?.message ?? String(e)
          const isUniqueViolation = /unique[_ ]?violation|duplicate key/i.test(msg)
          if (isUniqueViolation && attempts === 0) {
            attempts += 1
            await new Promise(r => setTimeout(r, 100))
            continue
          }
          throw e
        }
      }

      clearPendingBackup()
      setStatus('saved')
      onSavedRef.current?.()
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => {
        setStatus(prev => (prev === 'saved' ? 'idle' : prev))
        savedTimerRef.current = null
      }, SAVED_DISPLAY_MS)

      inFlightRef.current = false

      const pending = pendingValueRef.current
      pendingValueRef.current = null
      if (pending !== null) {
        setTimeout(() => { void performSave(pending) }, 0)
      }
    } catch (e) {
      const msg = (e as Error)?.message ?? 'Erro ao guardar'
      setStatus('error')
      setError(msg)
      inFlightRef.current = false
    }
  }, [articleId, sessionId, buildLines, clearPendingBackup])

  const setQty = useCallback((key: string, raw: string): void => {
    const sanitized = sanitize(raw)
    setQtysState(prev => {
      const next = { ...prev, [key]: sanitized }
      latestQtysRef.current = next
      writePendingBackup(next)
      return next
    })
    setStatus('dirty')
    setError(null)

    if (inFlightRef.current) {
      pendingValueRef.current = { ...latestQtysRef.current, [key]: sanitized }
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      void performSave(latestQtysRef.current)
    }, debounceMs)
  }, [debounceMs, performSave, writePendingBackup])

  const step = useCallback((key: string, _bpu: number, _label: string, delta: number): void => {
    const current = latestQtysRef.current[key] ?? ''
    const parsed  = parseFloat((current || '0').replace(',', '.'))
    const base    = isNaN(parsed) ? 0 : parsed
    const next    = Math.max(0, base + delta)
    setQty(key, fmtForDisplay(next))
  }, [setQty])

  const flush = useCallback(async (): Promise<void> => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (inFlightRef.current) {
      pendingValueRef.current = latestQtysRef.current
      return
    }
    await performSave(latestQtysRef.current)
  }, [performSave])

  const retry = useCallback(async (): Promise<void> => {
    setError(null)
    await flush()
  }, [flush])

  // Hidratação inicial do backup. Igual ao inline.
  useEffect(() => {
    if (!sessionId || typeof window === 'undefined') return
    if (hydratedBackupRef.current) return
    hydratedBackupRef.current = true
    try {
      const raw = window.localStorage.getItem(pendingKey(sessionId, articleId))
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<{ qtys: Record<string, string> }>
      if (parsed.qtys && typeof parsed.qtys === 'object') {
        setQtysState(parsed.qtys)
        latestQtysRef.current = parsed.qtys
        setStatus('dirty')
        // Flush imediato — chef tinha algo por guardar antes de fechar/recarregar.
        void performSave(parsed.qtys)
      }
    } catch { /* ignore */ }
  }, [sessionId, articleId, performSave])

  // Best-effort flush em visibility/pagehide
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const tryFlush = () => {
      if (debounceRef.current === null && !inFlightRef.current) return
      void flush()
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') tryFlush() }
    const onPageHide   = () => { tryFlush() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [flush])

  // Cleanup no unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current)   clearTimeout(debounceRef.current)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  // Total e hasAny derivados
  let total = 0
  let hasAny = false
  if (packagings) {
    for (const p of packagings) {
      const raw = qtys[packagingKey(p)] ?? ''
      const n   = parseQty(raw)
      if (Number.isFinite(n) && n > 0) {
        total += n * p.base_per_unit
        hasAny = true
      }
    }
  }

  return { qtys, status, error, setQty, step, flush, retry, total, hasAny }
}
