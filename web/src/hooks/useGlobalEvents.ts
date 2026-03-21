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
const openHandlers = new Set<() => void>()
const errorHandlers = new Set<() => void>()

export type GlobalEventHandlers = Partial<Record<string, (event: MessageEvent) => void>>

export function useGlobalEvents(handlers: GlobalEventHandlers): void {
  useEffect(() => {
    refCount++
    if (!singletonEs) {
      singletonEs = new EventSource('/api/events')
      singletonEs.onopen = () => {
        openHandlers.forEach(h => h())
      }
      singletonEs.onerror = () => {
        errorHandlers.forEach(h => h())
      }
    }

    // Register __open / __error lifecycle callbacks
    const onOpen = handlers.__open as unknown as (() => void) | undefined
    const onError = handlers.__error as unknown as (() => void) | undefined
    if (onOpen) { openHandlers.add(onOpen); if (singletonEs?.readyState === EventSource.OPEN) onOpen() }
    if (onError) errorHandlers.add(onError)

    const entries = Object.entries(handlers).filter(([k, h]) => h != null && k !== '__open' && k !== '__error') as [string, (e: MessageEvent) => void][]

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
      if (onOpen) openHandlers.delete(onOpen)
      if (onError) errorHandlers.delete(onError)
      for (const [eventType, handler] of entries) {
        handlerMap.get(eventType)?.delete(handler)
      }
      refCount--
      if (refCount === 0 && singletonEs) {
        singletonEs.close()
        singletonEs = null
        handlerMap.clear()
        openHandlers.clear()
        errorHandlers.clear()
      }
    }
  }, []) // mount-only; handlers registered by stable identity
}
