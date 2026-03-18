import { fetchDiskWaveStatus } from '../api'
import { AgentOutputData, AgentToolCallData } from '../types'
import {
  waveEventsReducer,
  initialWaveState,
  AppWaveState,
  WaveAction,
  buildWaves,
} from '../hooks/waveEventsReducer'

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

    // Wire up all SSE event listeners (replicated from useWaveEvents.ts lines 84-265)
    es.addEventListener('scaffold_started', () => {
      dispatch(slug, { type: 'SCAFFOLD_STARTED' })
    })

    es.addEventListener('scaffold_output', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { chunk: string }
      dispatch(slug, { type: 'SCAFFOLD_OUTPUT', chunk: data.chunk })
    })

    es.addEventListener('scaffold_complete', () => {
      dispatch(slug, { type: 'SCAFFOLD_COMPLETE' })
    })

    es.addEventListener('scaffold_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { error: string }
      dispatch(slug, { type: 'SCAFFOLD_FAILED', error: data.error })
    })

    es.addEventListener('agent_started', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { agent: string; wave: number; files: string[] }
      dispatch(slug, { type: 'AGENT_STARTED', agent: data.agent, wave: data.wave, files: data.files })
    })

    es.addEventListener('agent_complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as {
        agent: string
        wave: number
        status: string
        branch: string
      }
      dispatch(slug, { type: 'AGENT_COMPLETE', agent: data.agent, wave: data.wave, branch: data.branch })
    })

    es.addEventListener('agent_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as {
        agent: string
        wave: number
        status: string
        failure_type: string
        notes?: string
        message: string
      }
      dispatch(slug, {
        type: 'AGENT_FAILED',
        agent: data.agent,
        wave: data.wave,
        failure_type: data.failure_type,
        notes: data.notes,
        message: data.message,
      })
    })

    es.addEventListener('agent_output', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as AgentOutputData
      dispatch(slug, { type: 'AGENT_OUTPUT', agent: data.agent, wave: data.wave, chunk: data.chunk })
    })

    es.addEventListener('agent_tool_call', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as AgentToolCallData
      dispatch(slug, {
        type: 'AGENT_TOOL_CALL',
        agent: data.agent,
        wave: data.wave,
        tool_id: data.tool_id,
        tool_name: data.tool_name,
        input: data.input,
        is_result: data.is_result,
        is_error: data.is_error,
        duration_ms: data.duration_ms,
      })
    })

    es.addEventListener('wave_complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { wave: number; merge_status: string }
      dispatch(slug, { type: 'WAVE_COMPLETE', wave: data.wave, merge_status: data.merge_status })
    })

    es.addEventListener('run_complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { status: string; waves: number; agents: number }
      dispatch(slug, { type: 'RUN_COMPLETE', status: data.status })
    })

    es.addEventListener('run_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { error: string }
      dispatch(slug, { type: 'RUN_FAILED', error: data.error })
    })

    es.addEventListener('wave_gate_pending', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { wave: number; next_wave: number; slug: string }
      dispatch(slug, { type: 'WAVE_GATE_PENDING', wave: data.wave, next_wave: data.next_wave })
    })

    es.addEventListener('wave_gate_resolved', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { wave: number; action: string }
      void data // consumed for side-effect only
      dispatch(slug, { type: 'WAVE_GATE_RESOLVED' })
    })

    es.addEventListener('merge_started', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number }
      dispatch(slug, { type: 'MERGE_STARTED', wave: data.wave })
    })

    es.addEventListener('merge_output', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; chunk: string }
      dispatch(slug, { type: 'MERGE_OUTPUT', wave: data.wave, chunk: data.chunk })
    })

    es.addEventListener('merge_complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; status: string }
      dispatch(slug, { type: 'MERGE_COMPLETE', wave: data.wave })
    })

    es.addEventListener('merge_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as {
        slug: string
        wave: number
        error: string
        conflicting_files: string[]
      }
      dispatch(slug, {
        type: 'MERGE_FAILED',
        wave: data.wave,
        error: data.error,
        conflicting_files: data.conflicting_files,
      })
    })

    es.addEventListener('conflict_resolving', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; file: string }
      dispatch(slug, { type: 'CONFLICT_RESOLVING', wave: data.wave, file: data.file })
    })

    es.addEventListener('conflict_resolved', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; file: string }
      dispatch(slug, { type: 'CONFLICT_RESOLVED', wave: data.wave, file: data.file })
    })

    es.addEventListener('conflict_resolution_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; file: string; error: string }
      dispatch(slug, {
        type: 'CONFLICT_RESOLUTION_FAILED',
        wave: data.wave,
        file: data.file,
        error: data.error,
      })
    })

    es.addEventListener('test_started', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number }
      dispatch(slug, { type: 'TEST_STARTED', wave: data.wave })
    })

    es.addEventListener('test_output', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; chunk: string }
      dispatch(slug, { type: 'TEST_OUTPUT', wave: data.wave, chunk: data.chunk })
    })

    es.addEventListener('test_complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; status: string }
      dispatch(slug, { type: 'TEST_COMPLETE', wave: data.wave })
    })

    es.addEventListener('test_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as {
        slug: string
        wave: number
        status: string
        output: string
      }
      dispatch(slug, { type: 'TEST_FAILED', wave: data.wave, output: data.output })
    })

    es.addEventListener('stale_branches_detected', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; branches: string[]; count: number }
      dispatch(slug, {
        type: 'STALE_BRANCHES_DETECTED',
        slug: data.slug,
        branches: data.branches,
        count: data.count,
      })
    })

    es.addEventListener('stage_transition', (event: MessageEvent) => {
      const entry = JSON.parse(event.data) as {
        stage: string
        status: 'running' | 'complete' | 'failed' | 'skipped'
        wave_num?: number
        message?: string
        started_at?: string
        completed_at?: string
      }
      dispatch(slug, { type: 'STAGE_TRANSITION', entry })
    })

    es.addEventListener('pipeline_step', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as {
        step: string
        status: string
        wave: number
        error?: string
      }
      dispatch(slug, {
        type: 'PIPELINE_STEP',
        step: data.step,
        status: data.status,
        wave: data.wave,
        error: data.error,
      })
    })

    es.addEventListener('fix_build_started', () => {
      dispatch(slug, { type: 'FIX_BUILD_STARTED' })
    })

    es.addEventListener('fix_build_output', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { chunk: string }
      dispatch(slug, { type: 'FIX_BUILD_OUTPUT', chunk: data.chunk })
    })

    es.addEventListener('fix_build_complete', () => {
      dispatch(slug, { type: 'FIX_BUILD_COMPLETE' })
    })

    es.addEventListener('fix_build_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { error: string }
      dispatch(slug, { type: 'FIX_BUILD_FAILED', error: data.error })
    })
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
