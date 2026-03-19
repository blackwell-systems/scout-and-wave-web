import { useEffect, useRef, useReducer } from 'react'
import { fetchDiskWaveStatus } from '../api'
import { AgentStatus } from '../types'
import {
  waveEventsReducer,
  initialWaveState,
  AppWaveState,
  buildWaves,
} from './waveEventsReducer'
import { attachWaveEventListeners } from '../lib/waveEventListeners'

// Re-export types for backward compatibility
export type {
  AppWaveState,
  WaveMergeState,
  WaveTestState,
  StageEntry,
  StaleBranchesInfo,
} from './waveEventsReducer'

// useWaveEvents subscribes to the SSE stream for a given slug and returns
// live agent + wave state. The return type is AppWaveState (a superset of
// WaveState from types.ts) because the stream covers multiple waves and
// top-level scaffold/run state that WaveState does not model.
export function useWaveEvents(slug: string): AppWaveState {
  const [state, dispatch] = useReducer(waveEventsReducer, initialWaveState)
  const esRef = useRef<EventSource | null>(null)

  // Reset state when slug changes so stale data from the previous IMPL is cleared.
  useEffect(() => {
    dispatch({ type: 'RESET' })
  }, [slug])

  // Seed agent, wave, and merge state from disk status on mount — covers
  // work completed in previous sessions whose SSE events are no longer available.
  useEffect(() => {
    fetchDiskWaveStatus(slug).then(disk => {
      // Seed agents from disk completion reports
      let agents: AgentStatus[] = []
      if (disk.agents && disk.agents.length > 0) {
        agents = disk.agents.map(da => ({
          agent: da.agent,
          wave: da.wave,
          status: (da.status === 'complete' ? 'complete' : da.status === 'blocked' ? 'failed' : 'pending') as 'complete' | 'failed' | 'pending',
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
      const scaffoldStatus = disk.scaffold_status === 'committed'
        ? ('complete' as const)
        : ('idle' as const)

      // Seed merge state from waves_merged
      const mergedWaves = disk.waves_merged ?? []

      dispatch({
        type: 'SEED_DISK_STATUS',
        agents,
        waves,
        scaffoldStatus,
        hasScaffolds: disk.scaffold_status !== 'none',
        mergedWaves,
      })
    }).catch(() => { /* disk status unavailable — SSE will provide state */ })
  }, [slug])

  useEffect(() => {
    const es = new EventSource(`/api/wave/${slug}/events`)
    esRef.current = es

    es.onopen = () => {
      dispatch({ type: 'CONNECT' })
    }

    es.onerror = () => {
      dispatch({ type: 'DISCONNECT' })
    }

    attachWaveEventListeners(es, dispatch)

    return () => {
      esRef.current?.close()
    }
  }, [slug])

  return state
}
