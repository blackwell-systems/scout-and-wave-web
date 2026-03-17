import { useEffect, useRef, useReducer } from 'react'
import { fetchDiskWaveStatus } from '../api'
import { AgentOutputData, AgentToolCallData, AgentStatus } from '../types'
import {
  waveEventsReducer,
  initialWaveState,
  AppWaveState,
  buildWaves,
} from './waveEventsReducer'

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

      // Seed scaffold status
      const scaffoldStatus = disk.scaffold_status === 'committed' || disk.scaffold_status === 'none'
        ? ('complete' as const)
        : ('idle' as const)

      // Seed merge state from waves_merged
      const mergedWaves = disk.waves_merged ?? []

      dispatch({
        type: 'SEED_DISK_STATUS',
        agents,
        waves,
        scaffoldStatus,
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

    es.addEventListener('scaffold_started', () => {
      dispatch({ type: 'SCAFFOLD_STARTED' })
    })

    es.addEventListener('scaffold_output', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { chunk: string }
      dispatch({ type: 'SCAFFOLD_OUTPUT', chunk: data.chunk })
    })

    es.addEventListener('scaffold_complete', () => {
      dispatch({ type: 'SCAFFOLD_COMPLETE' })
    })

    es.addEventListener('scaffold_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { error: string }
      dispatch({ type: 'SCAFFOLD_FAILED', error: data.error })
    })

    es.addEventListener('agent_started', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { agent: string; wave: number; files: string[] }
      dispatch({ type: 'AGENT_STARTED', agent: data.agent, wave: data.wave, files: data.files })
    })

    es.addEventListener('agent_complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as {
        agent: string
        wave: number
        status: string
        branch: string
      }
      dispatch({ type: 'AGENT_COMPLETE', agent: data.agent, wave: data.wave, branch: data.branch })
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
      dispatch({
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
      dispatch({ type: 'AGENT_OUTPUT', agent: data.agent, wave: data.wave, chunk: data.chunk })
    })

    es.addEventListener('agent_tool_call', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as AgentToolCallData
      dispatch({
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
      dispatch({ type: 'WAVE_COMPLETE', wave: data.wave, merge_status: data.merge_status })
    })

    es.addEventListener('run_complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { status: string; waves: number; agents: number }
      dispatch({ type: 'RUN_COMPLETE', status: data.status })
    })

    es.addEventListener('run_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { error: string }
      dispatch({ type: 'RUN_FAILED', error: data.error })
    })

    es.addEventListener('wave_gate_pending', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { wave: number; next_wave: number; slug: string }
      dispatch({ type: 'WAVE_GATE_PENDING', wave: data.wave, next_wave: data.next_wave })
    })

    es.addEventListener('wave_gate_resolved', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { wave: number; action: string }
      void data // consumed for side-effect only
      dispatch({ type: 'WAVE_GATE_RESOLVED' })
    })

    es.addEventListener('merge_started', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number }
      dispatch({ type: 'MERGE_STARTED', wave: data.wave })
    })

    es.addEventListener('merge_output', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; chunk: string }
      dispatch({ type: 'MERGE_OUTPUT', wave: data.wave, chunk: data.chunk })
    })

    es.addEventListener('merge_complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; status: string }
      dispatch({ type: 'MERGE_COMPLETE', wave: data.wave })
    })

    es.addEventListener('merge_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; error: string; conflicting_files: string[] }
      dispatch({ type: 'MERGE_FAILED', wave: data.wave, error: data.error, conflicting_files: data.conflicting_files })
    })

    es.addEventListener('conflict_resolving', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; file: string }
      dispatch({ type: 'CONFLICT_RESOLVING', wave: data.wave, file: data.file })
    })

    es.addEventListener('conflict_resolved', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; file: string }
      dispatch({ type: 'CONFLICT_RESOLVED', wave: data.wave, file: data.file })
    })

    es.addEventListener('conflict_resolution_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; file: string; error: string }
      dispatch({ type: 'CONFLICT_RESOLUTION_FAILED', wave: data.wave, file: data.file, error: data.error })
    })

    es.addEventListener('test_started', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number }
      dispatch({ type: 'TEST_STARTED', wave: data.wave })
    })

    es.addEventListener('test_output', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; chunk: string }
      dispatch({ type: 'TEST_OUTPUT', wave: data.wave, chunk: data.chunk })
    })

    es.addEventListener('test_complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; status: string }
      dispatch({ type: 'TEST_COMPLETE', wave: data.wave })
    })

    es.addEventListener('test_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; status: string; output: string }
      dispatch({ type: 'TEST_FAILED', wave: data.wave, output: data.output })
    })

    es.addEventListener('stale_branches_detected', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; branches: string[]; count: number }
      dispatch({ type: 'STALE_BRANCHES_DETECTED', slug: data.slug, branches: data.branches, count: data.count })
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
      dispatch({ type: 'STAGE_TRANSITION', entry })
    })

    es.addEventListener('fix_build_started', () => {
      dispatch({ type: 'FIX_BUILD_STARTED' })
    })

    es.addEventListener('fix_build_output', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { chunk: string }
      dispatch({ type: 'FIX_BUILD_OUTPUT', chunk: data.chunk })
    })

    es.addEventListener('fix_build_complete', () => {
      dispatch({ type: 'FIX_BUILD_COMPLETE' })
    })

    es.addEventListener('fix_build_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { error: string }
      dispatch({ type: 'FIX_BUILD_FAILED', error: data.error })
    })

    return () => {
      esRef.current?.close()
    }
  }, [slug])

  return state
}
