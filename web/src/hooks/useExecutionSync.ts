import { useMemo } from 'react'
import { useWaveEvents } from './useWaveEvents'

export interface AgentExecStatus {
  status: 'pending' | 'running' | 'complete' | 'failed'
  agent: string
  wave: number
  failureType?: string
}

export interface WaveProgress {
  complete: number
  total: number
  mergeStatus?: 'idle' | 'merging' | 'success' | 'failed'
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

export function useExecutionSync(slug: string | undefined): ExecutionSyncState {
  const appState = useWaveEvents(slug ?? '')

  return useMemo(() => {
    if (!slug) {
      return IDLE_STATE
    }

    const agents = new Map<string, AgentExecStatus>()
    for (const a of appState.agents) {
      const key = `${a.wave}:${a.agent}`
      agents.set(key, {
        status: a.status as AgentExecStatus['status'],
        agent: a.agent,
        wave: a.wave,
        failureType: a.failure_type,
      })
    }

    const waveProgress = new Map<number, WaveProgress>()
    for (const wave of appState.waves) {
      const total = wave.agents.length
      const complete = wave.agents.filter(a => a.status === 'complete').length
      const mergeState = appState.wavesMergeState.get(wave.wave)
      waveProgress.set(wave.wave, {
        complete,
        total,
        mergeStatus: mergeState?.status,
      })
    }

    const scaffoldStatus = appState.scaffoldStatus === 'failed'
      ? 'idle'
      : (appState.scaffoldStatus as ExecutionSyncState['scaffoldStatus'])

    const isLive = appState.connected && !appState.runComplete

    return { agents, waveProgress, scaffoldStatus, isLive }
  }, [slug, appState])
}
