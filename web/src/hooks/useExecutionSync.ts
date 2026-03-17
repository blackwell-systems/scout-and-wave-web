import { useMemo } from 'react'
import { useWaveEvents, AppWaveState } from './useWaveEvents'
import { AgentStatus } from '../types'

export interface AgentExecStatus {
  status: 'pending' | 'running' | 'complete' | 'failed'
  agent: string
  wave: number
  failureType?: string
}

export interface WaveProgress {
  complete: number
  total: number
  mergeStatus?: 'idle' | 'merging' | 'success' | 'failed' | 'resolving'
}

export interface ExecutionSyncState {
  /** O(1) lookup by "wave:agent" key, e.g. "1:A" */
  agents: Map<string, AgentExecStatus>
  /** Per-wave progress: complete/total counts */
  waveProgress: Map<number, WaveProgress>
  /** Scaffold lifecycle status */
  scaffoldStatus: 'idle' | 'running' | 'complete'
  /** Whether any execution is active (SSE connected + not run_complete) */
  isLive: boolean
}

const IDLE_STATE: ExecutionSyncState = {
  agents: new Map(),
  waveProgress: new Map(),
  scaffoldStatus: 'idle',
  isLive: false,
}

function mapAgentStatus(raw: AgentStatus): AgentExecStatus {
  // AgentStatusValue from types.ts includes 'failed'; ExecutionSyncState uses same set
  const status = raw.status as AgentExecStatus['status']
  const result: AgentExecStatus = {
    status,
    agent: raw.agent,
    wave: raw.wave,
  }
  if (raw.failure_type) {
    result.failureType = raw.failure_type
  }
  return result
}

function normalizeScaffoldStatus(
  raw: AppWaveState['scaffoldStatus']
): ExecutionSyncState['scaffoldStatus'] {
  // AppWaveState.scaffoldStatus can be 'idle' | 'running' | 'complete' | 'failed'
  // ExecutionSyncState.scaffoldStatus is 'idle' | 'running' | 'complete'
  // Map 'failed' to 'idle' as a safe fallback
  if (raw === 'failed') return 'idle'
  return raw
}

export function useExecutionSync(slug: string | undefined): ExecutionSyncState {
  const state = useWaveEvents(slug ?? '')

  const agents = useMemo<Map<string, AgentExecStatus>>(() => {
    if (!slug) return new Map()
    const map = new Map<string, AgentExecStatus>()
    for (const agent of state.agents) {
      const key = `${agent.wave}:${agent.agent}`
      map.set(key, mapAgentStatus(agent))
    }
    return map
  }, [state.agents, slug])

  const waveProgress = useMemo<Map<number, WaveProgress>>(() => {
    if (!slug) return new Map()
    const map = new Map<number, WaveProgress>()
    for (const wave of state.waves) {
      const completeCount = wave.agents.filter(a => a.status === 'complete').length
      const mergeStateEntry = state.wavesMergeState.get(wave.wave)
      const progress: WaveProgress = {
        complete: completeCount,
        total: wave.agents.length,
      }
      if (mergeStateEntry) {
        progress.mergeStatus = mergeStateEntry.status
      }
      map.set(wave.wave, progress)
    }
    return map
  }, [state.waves, state.wavesMergeState, slug])

  const scaffoldStatus = normalizeScaffoldStatus(state.scaffoldStatus)
  const isLive = !!(slug) && state.connected && !state.runComplete

  if (!slug) return IDLE_STATE

  return {
    agents,
    waveProgress,
    scaffoldStatus,
    isLive,
  }
}
