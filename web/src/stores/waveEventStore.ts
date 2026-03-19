import { fetchDiskWaveStatus } from '../api'
import {
  waveEventsReducer,
  initialWaveState,
  AppWaveState,
  WaveAction,
  buildWaves,
} from '../hooks/waveEventsReducer'
import { attachWaveEventListeners } from '../lib/waveEventListeners'

/**
 * Internal per-slug state held by the singleton store.
 * Not exported to consumers — used only inside waveEventStore.ts.
 */
interface SlugEntry {
  state: AppWaveState
  eventSource: EventSource | null
  refCount: number
  listeners: Set<() => void>
  seeded: boolean
}

/**
 * Module-level singleton Map holding all slug entries.
 * State persists across React component mount/unmount cycles.
 */
const store = new Map<string, SlugEntry>()

/**
 * Returns the current AppWaveState for a given slug.
 * Called by useSyncExternalStore as the getSnapshot argument.
 * Returns initialWaveState if no entry exists for the slug.
 * CRITICAL: must return referentially stable object (same reference if state has not changed)
 * to avoid infinite re-renders.
 */
export function getSnapshot(slug: string): AppWaveState {
  const entry = store.get(slug)
  if (!entry) {
    return initialWaveState
  }
  return entry.state
}

/**
 * Subscribes a React component to state changes for a given slug.
 * On first subscriber (refCount 0 -> 1): opens the EventSource SSE connection and
 * runs disk seeding via fetchDiskWaveStatus.
 * On last unsubscribe (refCount 1 -> 0): closes the EventSource but RETAINS state
 * in the Map so remounts get cached state.
 * Returns an unsubscribe function compatible with useSyncExternalStore's subscribe signature.
 */
export function subscribe(slug: string, listener: () => void): () => void {
  // Get or create entry
  let entry = store.get(slug)
  if (!entry) {
    entry = {
      state: initialWaveState,
      eventSource: null,
      refCount: 0,
      listeners: new Set(),
      seeded: false,
    }
    store.set(slug, entry)
  }

  // Add listener
  entry.listeners.add(listener)
  entry.refCount++

  // If this is the first subscriber, open EventSource and seed from disk
  if (entry.refCount === 1) {
    // Seed from disk if not already seeded
    if (!entry.seeded) {
      entry.seeded = true
      fetchDiskWaveStatus(slug)
        .then(disk => {
          // Seed agents from disk completion reports
          let agents: any[] = []
          if (disk.agents && disk.agents.length > 0) {
            agents = disk.agents.map(da => ({
              agent: da.agent,
              wave: da.wave,
              status:
                da.status === 'complete'
                  ? ('complete' as const)
                  : da.status === 'blocked'
                  ? ('failed' as const)
                  : ('pending' as const),
              files: da.files ?? [],
              branch: da.branch,
              failure_type: da.failure_type,
              message: da.message,
            }))
          }

          // Build waves from seeded agents
          const waves = buildWaves(agents, [])

          // Mark waves complete if all agents are complete
          for (const w of waves) {
            w.complete = w.agents.length > 0 && w.agents.every(a => a.status === 'complete')
          }

          // Seed scaffold status — 'none' means no scaffolds exist, keep idle
          const scaffoldStatus =
            disk.scaffold_status === 'committed'
              ? 'complete'
              : 'idle'

          // Seed merge state from waves_merged
          const mergedWaves = disk.waves_merged ?? []

          dispatch(slug, {
            type: 'SEED_DISK_STATUS',
            agents,
            waves,
            scaffoldStatus,
            hasScaffolds: disk.scaffold_status !== 'none',
            mergedWaves,
          })
        })
        .catch(() => {
          // disk status unavailable — SSE will provide state
        })
    }

    // Open EventSource
    const es = new EventSource(`/api/wave/${slug}/events`)
    entry.eventSource = es

    es.onopen = () => {
      dispatch(slug, { type: 'CONNECT' })
    }

    es.onerror = () => {
      dispatch(slug, { type: 'DISCONNECT' })
    }

    // Wire up all SSE event listeners via shared utility (R4 deduplication)
    attachWaveEventListeners(es, (action) => dispatch(slug, action))
  }

  // Return unsubscribe function
  return () => {
    const entry = store.get(slug)
    if (!entry) return

    entry.listeners.delete(listener)
    entry.refCount--

    // If last subscriber, close EventSource but KEEP the entry and state
    if (entry.refCount === 0 && entry.eventSource) {
      entry.eventSource.close()
      entry.eventSource = null
    }
  }
}

/**
 * Dispatches a WaveAction to the store for a given slug.
 * Runs the existing waveEventsReducer, replaces the entry's state, and notifies all listeners.
 * Used internally by SSE event handlers. Not called by React components directly.
 */
export function dispatch(slug: string, action: WaveAction): void {
  let entry = store.get(slug)
  if (!entry) {
    // Create entry if it doesn't exist
    entry = {
      state: initialWaveState,
      eventSource: null,
      refCount: 0,
      listeners: new Set(),
      seeded: false,
    }
    store.set(slug, entry)
  }

  // Run reducer
  const newState = waveEventsReducer(entry.state, action)

  // Only update state and notify if it actually changed (referential stability)
  if (newState !== entry.state) {
    entry.state = newState

    // Notify all listeners
    entry.listeners.forEach(listener => listener())
  }
}

/**
 * Test-only function that clears all entries from the store Map and closes
 * any open EventSources. Exported for use in test afterEach cleanup.
 */
export function resetStore(): void {
  store.forEach(entry => {
    if (entry.eventSource) {
      entry.eventSource.close()
    }
  })
  store.clear()
}
