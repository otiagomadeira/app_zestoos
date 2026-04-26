'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { recordStockCountInline } from '@/lib/stockCount'

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface UseArticleAutosaveOptions {
  articleId:    string
  sessionId:    string | null   // null enquanto useInventorySession ainda não hidratou
  initialQty:   string          // valor inicial em stock_unit (já formatado para o input)
  onSaved?:     () => void      // callback após save bem-sucedido (ex.: addCounted)
  debounceMs?:  number          // default 1200
}

export interface UseArticleAutosave {
  qty:    string
  status: AutosaveStatus
  error:  string | null
  setQty: (raw: string) => void
  flush:  () => Promise<void>
  retry:  () => Promise<void>
}

const DEFAULT_DEBOUNCE = 1200
const SAVED_DISPLAY_MS  = 2000

function pendingKey(sessionId: string, articleId: string): string {
  return `zesto.inventory.pending.${sessionId}.${articleId}`
}

// Sanitiza input de utilizador: substitui vírgula PT por ponto, descarta
// caracteres não-numéricos (excepto ponto), trunca a 8 chars (consistente
// com PackagingLine.tsx).
function sanitize(raw: string): string {
  return raw.replace(',', '.').replace(/[^\d.]/g, '').slice(0, 8)
}

// Converte string sanitizada em número. Vazio → 0 (caso "confirmar 0").
// NaN/negativo/infinito → null (caller marca status = 'error').
function parseQty(qty: string): number | null {
  const trimmed = qty.trim()
  if (trimmed === '' || trimmed === '.') return 0
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

/**
 * Hook de autosave inline para artigos single-packaging (Fase C1.2).
 *
 * Comportamento:
 *   - `setQty(raw)` actualiza imediatamente o valor local, marca `dirty`,
 *     escreve backup em localStorage e agenda flush via debounce (1200ms default).
 *   - `flush()` cancela o debounce e dispara o RPC. Se já há save em curso,
 *     o valor mais recente fica em queue e dispara nova call quando a primeira
 *     terminar (coalescing).
 *   - Em sucesso: limpa backup, dispara `onSaved`, transita `saving → saved → idle`.
 *   - Em erro: status `error` persiste. `setQty` ou `retry()` reentram no fluxo.
 *
 * Tolerância a falhas:
 *   - `recordStockCountInline` já trata unique_violation no RPC. Mantemos um
 *     retry defensivo de 1 tentativa client-side caso, por alguma razão, o erro
 *     escape (rede instável + concorrência muito agressiva).
 *   - Backup em localStorage por (sessionId, articleId) é a rede de segurança
 *     contra ciclos de vida agressivos do iOS Safari (background, swipe-up).
 *     Ao montar com pending diferente do initialQty, dispara save imediato.
 *   - Handler `visibilitychange`/`pagehide` faz best-effort flush. Em iOS este
 *     handler nem sempre completa fetches em flight — o backup serve de fallback.
 *
 * Limitações conhecidas (a tratar em C1.3 ou posterior):
 *   - Se `initialQty` mudar externamente (ex.: encomenda recebida noutra aba),
 *     o hook não re-sincroniza. Componente externo deve usar `key` para reset.
 *   - O hook não chama RPC se `sessionId` for null. `setQty` continua a actualizar
 *     o valor local; ao receber sessionId válido, primeiro flush dispara.
 */
export function useArticleAutosave({
  articleId,
  sessionId,
  initialQty,
  onSaved,
  debounceMs = DEFAULT_DEBOUNCE,
}: UseArticleAutosaveOptions): UseArticleAutosave {
  const [qty,    setQtyState] = useState<string>(initialQty)
  const [status, setStatus]   = useState<AutosaveStatus>('idle')
  const [error,  setError]    = useState<string | null>(null)

  const debounceRef       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRef       = useRef<boolean>(false)
  const pendingValueRef   = useRef<string | null>(null)
  const latestQtyRef      = useRef<string>(initialQty)
  const onSavedRef        = useRef<typeof onSaved>(onSaved)
  const hydratedBackupRef = useRef<boolean>(false)

  useEffect(() => { onSavedRef.current = onSaved }, [onSaved])
  useEffect(() => { latestQtyRef.current = qty },   [qty])

  const clearPendingBackup = useCallback(() => {
    if (!sessionId || typeof window === 'undefined') return
    try {
      window.localStorage.removeItem(pendingKey(sessionId, articleId))
    } catch { /* ignore */ }
  }, [sessionId, articleId])

  const writePendingBackup = useCallback((value: string) => {
    if (!sessionId || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(
        pendingKey(sessionId, articleId),
        JSON.stringify({ qty: value, ts: Date.now() })
      )
    } catch { /* ignore */ }
  }, [sessionId, articleId])

  // Save efectivo. Não public; setQty/flush invocam-no.
  // Não usa useCallback porque depende de cleanup de timers internos
  // — re-criar a referência por mudança de deps é seguro aqui.
  const performSave = useCallback(async (qtyToSave: string): Promise<void> => {
    if (!sessionId) {
      // Sessão ainda não pronta. Mantemos `dirty` e o backup em localStorage
      // até hidratar. Quando sessionId hidratar, o effect de hidratação
      // dispara save automaticamente.
      return
    }

    const parsed = parseQty(qtyToSave)
    if (parsed === null) {
      setStatus('error')
      setError('Quantidade inválida')
      return
    }

    inFlightRef.current = true
    setStatus('saving')
    setError(null)

    try {
      let attempts = 0
      // Loop com retry defensivo para unique_violation. O RPC já trata
      // internamente, mas se algo escapar (rede glitch + race), tentamos 1x.
      for (;;) {
        try {
          await recordStockCountInline(articleId, parsed, sessionId)
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

      // Sucesso
      clearPendingBackup()
      setStatus('saved')
      onSavedRef.current?.()
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => {
        setStatus(prev => (prev === 'saved' ? 'idle' : prev))
        savedTimerRef.current = null
      }, SAVED_DISPLAY_MS)

      inFlightRef.current = false

      // Coalescing: se setQty foi chamado durante o save com valor diferente,
      // dispara nova call.
      const pending = pendingValueRef.current
      pendingValueRef.current = null
      if (pending !== null && pending !== qtyToSave) {
        // Não recursa síncronamente: deixa React commitar o estado actual.
        setTimeout(() => { void performSave(pending) }, 0)
      }
    } catch (e) {
      const msg = (e as Error)?.message ?? 'Erro ao guardar'
      setStatus('error')
      setError(msg)
      inFlightRef.current = false
      // Não drain pending em erro: preserva intent do utilizador, que
      // pode ver `!` e fazer retry. setQty ou retry voltam a entrar.
    }
  }, [articleId, sessionId, clearPendingBackup])

  const setQty = useCallback((raw: string): void => {
    const sanitized = sanitize(raw)
    setQtyState(sanitized)
    latestQtyRef.current = sanitized
    setStatus('dirty')
    setError(null)
    writePendingBackup(sanitized)

    if (inFlightRef.current) {
      // Save em curso: queue para drain pós-save.
      pendingValueRef.current = sanitized
      return
    }

    // Reset debounce
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      void performSave(sanitized)
    }, debounceMs)
  }, [debounceMs, performSave, writePendingBackup])

  const flush = useCallback(async (): Promise<void> => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (inFlightRef.current) {
      // Já há save em curso. Marca o último valor como pending para drain.
      pendingValueRef.current = latestQtyRef.current
      return
    }
    await performSave(latestQtyRef.current)
  }, [performSave])

  const retry = useCallback(async (): Promise<void> => {
    setError(null)
    await flush()
  }, [flush])

  // Hidratação inicial: se há backup pendente diferente do initialQty,
  // assume-o e dispara save imediato. Corre só uma vez por (articleId, sessionId).
  useEffect(() => {
    if (!sessionId || typeof window === 'undefined') return
    if (hydratedBackupRef.current) return
    hydratedBackupRef.current = true
    try {
      const raw = window.localStorage.getItem(pendingKey(sessionId, articleId))
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<{ qty: string; ts: number }>
      const pendingQty = typeof parsed.qty === 'string' ? parsed.qty : null
      if (pendingQty !== null && pendingQty !== initialQty) {
        setQtyState(pendingQty)
        latestQtyRef.current = pendingQty
        setStatus('dirty')
        // Flush imediato — não esperar pelo debounce, o utilizador "já tinha
        // tentado guardar" antes de a aba ter sido fechada/recarregada.
        void performSave(pendingQty)
      }
    } catch { /* ignore */ }
  }, [sessionId, articleId, initialQty, performSave])

  // Best-effort: ao tornar a página invisível ou descarregar, tenta flush.
  // Em iOS Safari nem sempre completa o fetch em flight — daí o backup em
  // localStorage como rede de segurança.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const tryFlush = () => {
      const dirty = latestQtyRef.current
      if (dirty === undefined) return
      if (debounceRef.current === null && !inFlightRef.current) {
        // Não há debounce pendente nem save em curso → nada a fazer.
        return
      }
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

  // Cleanup de timers no unmount. Não fazemos flush async aqui porque
  // o React não garante completion em iOS Safari — o localStorage backup
  // é a rede de segurança para esse cenário.
  useEffect(() => {
    return () => {
      if (debounceRef.current)   clearTimeout(debounceRef.current)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  return { qty, status, error, setQty, flush, retry }
}
