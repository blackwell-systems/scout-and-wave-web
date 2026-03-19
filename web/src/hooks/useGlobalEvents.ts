import { useEffect } from 'react'

/**
 * Singleton hook for the shared /api/events EventSource connection.
 *
 * Usage:
 *   useGlobalEvents({ impl_list_updated: useCallback(() => { ... }, []) })
 *
 * IMPORTANT: Callers MUST pass stable handler references (via useCallback with
 * no or stable deps) to avoid re-registration on every render. The dependency
 * array of this hook is intentionally empty — handlers are registered once on
 * mount and removed on unmount.
 *
 * TODO: Per-consumer onOpen/onError callbacks could be added via reserved
 * '__open' and '__error' keys if the sseConnected indicator becomes safety-
 * critical in a future multi-user context.
 */

let singletonEs: EventSource | null = null
let refCount = 0
const handlerMap = new Map<string, Set<(event: MessageEvent) => void>>()

export type GlobalEventHandlers = Partial<Record<string, (event: MessageEvent) => void>>

export function useGlobalEvents(handlers: GlobalEventHandlers): void {
  useEffect(() => {
    refCount++
    if (!singletonEs) {
      singletonEs = new EventSource('/api/events')
      singletonEs.onerror = () => {
        // EventSource will auto-reconnect; no per-consumer error propagation here.
      }
    }

    const entries = Object.entries(handlers).filter(([, h]) => h != null) as [string, (e: MessageEvent) => void][]

    for (const [eventType, handler] of entries) {
      if (!handlerMap.has(eventType)) {
        handlerMap.set(eventType, new Set())
        const es = singletonEs!
        es.addEventListener(eventType, (e) => {
          handlerMap.get(eventType)?.forEach(h => h(e as MessageEvent))
        })
      }
      handlerMap.get(eventType)!.add(handler)
    }

    return () => {
      for (const [eventType, handler] of entries) {
        handlerMap.get(eventType)?.delete(handler)
      }
      refCount--
      if (refCount === 0 && singletonEs) {
        singletonEs.close()
        singletonEs = null
        handlerMap.clear()
      }
    }
  }, []) // mount-only; handlers registered by stable identity
}
