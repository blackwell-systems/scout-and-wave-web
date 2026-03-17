import { useEffect, useRef, useState } from 'react'
import { fetchDiskWaveStatus } from '../api'
import { AgentOutputData, AgentStatus, AgentToolCallData, ToolCallEntry, WaveState } from '../types'

export interface WaveMergeState {
  status: 'idle' | 'merging' | 'success' | 'failed' | 'resolving'
  output: string
  conflictingFiles: string[]
  error?: string
  resolvingFile?: string      // NEW: currently resolving file
  resolvedFiles: string[]     // NEW: files resolved so far
  failedFile?: string         // NEW: file that failed resolution
  resolutionError?: string    // NEW: error from failed resolution
}

export interface WaveTestState {
  status: 'idle' | 'running' | 'pass' | 'fail'
  output: string
}

// AppWaveState is the composite state managed by the hook.
// WaveState in types.ts is per-wave; we expose a top-level shape here
// and also return the list of per-wave WaveState objects for WaveBoard grouping.
export interface StageEntry {
  stage: string
  status: 'running' | 'complete' | 'failed' | 'skipped'
  wave_num?: number
  message?: string
  started_at?: string
  completed_at?: string
}

export interface StaleBranchesInfo {
  slug: string
  branches: string[]
  count: number
}

export interface AppWaveState {
  agents: AgentStatus[]
  scaffoldStatus: 'idle' | 'running' | 'complete' | 'failed'
  scaffoldOutput: string
  runComplete: boolean
  runStatus?: string
  runFailed?: string
  connected: boolean
  error?: string
  waves: WaveState[]
  waveGate?: { wave: number; nextWave: number }
  wavesMergeState: Map<number, WaveMergeState>
  wavesTestState: Map<number, WaveTestState>
  stageEntries: StageEntry[]
  staleBranches?: StaleBranchesInfo
}

// useWaveEvents subscribes to the SSE stream for a given slug and returns
// live agent + wave state. The return type is AppWaveState (a superset of
// WaveState from types.ts) because the stream covers multiple waves and
// top-level scaffold/run state that WaveState does not model.
export function useWaveEvents(slug: string): AppWaveState {
  const [state, setState] = useState<AppWaveState>({
    agents: [],
    scaffoldStatus: 'idle',
    scaffoldOutput: '',
    runComplete: false,
    connected: false,
    waves: [],
    wavesMergeState: new Map(),
    wavesTestState: new Map(),
    stageEntries: [],
  })

  const esRef = useRef<EventSource | null>(null)

  // Seed agent, wave, and merge state from disk status on mount — covers
  // work completed in previous sessions whose SSE events are no longer available.
  useEffect(() => {
    fetchDiskWaveStatus(slug).then(disk => {
      setState(prev => {
        // Seed agents from disk completion reports
        let agents = prev.agents
        let waves = prev.waves
        if (disk.agents && disk.agents.length > 0 && prev.agents.length === 0) {
          agents = disk.agents.map(da => ({
            agent: da.agent,
            wave: da.wave,
            status: (da.status === 'complete' ? 'complete' : da.status === 'blocked' ? 'failed' : 'pending') as 'complete' | 'failed' | 'pending',
            files: da.files ?? [],
            branch: da.branch,
            failure_type: da.failure_type,
            message: da.message,
          }))
          // Build waves from seeded agents
          const waveMap = new Map<number, WaveState>()
          for (const a of agents) {
            if (!waveMap.has(a.wave)) {
              waveMap.set(a.wave, { wave: a.wave, agents: [], complete: false })
            }
            waveMap.get(a.wave)!.agents.push(a)
          }
          // Mark waves complete if all agents are complete
          for (const [, w] of waveMap) {
            w.complete = w.agents.length > 0 && w.agents.every(a => a.status === 'complete')
          }
          waves = Array.from(waveMap.values()).sort((a, b) => a.wave - b.wave)
        }

        // Seed scaffold status
        const scaffoldStatus = disk.scaffold_status === 'committed' || disk.scaffold_status === 'none'
          ? 'complete' as const
          : prev.scaffoldStatus

        // Seed merge state from waves_merged
        const mergeState = new Map(prev.wavesMergeState)
        if (disk.waves_merged) {
          for (const w of disk.waves_merged) {
            if (!mergeState.has(w)) {
              mergeState.set(w, { status: 'success', output: '', conflictingFiles: [], resolvedFiles: [] })
            }
          }
        }

        return { ...prev, agents, waves, scaffoldStatus, wavesMergeState: mergeState }
      })
    }).catch(() => { /* disk status unavailable — SSE will provide state */ })
  }, [slug])

  useEffect(() => {
    const es = new EventSource(`/api/wave/${slug}/events`)
    esRef.current = es

    es.onopen = () => {
      setState(prev => ({ ...prev, connected: true, error: undefined }))
    }

    es.onerror = () => {
      setState(prev => ({ ...prev, connected: false, error: 'Connection lost' }))
    }

    // Helper: upsert an agent into the agents list
    function upsertAgent(
      prev: AppWaveState,
      agent: string,
      wave: number,
      update: Partial<AgentStatus>
    ): AppWaveState {
      const existing = prev.agents.find(a => a.agent === agent && a.wave === wave)
      let updatedAgents: AgentStatus[]
      if (existing) {
        updatedAgents = prev.agents.map(a =>
          a.agent === agent && a.wave === wave ? { ...a, ...update } : a
        )
      } else {
        updatedAgents = [
          ...prev.agents,
          { agent, wave, files: [], status: 'pending', ...update } as AgentStatus,
        ]
      }
      // Rebuild waves from agents
      const waves = buildWaves(updatedAgents, prev.waves)
      return { ...prev, agents: updatedAgents, waves }
    }

    function buildWaves(agents: AgentStatus[], prevWaves: WaveState[]): WaveState[] {
      const waveMap = new Map<number, WaveState>()
      // Preserve existing wave metadata (merge_status, complete flag)
      for (const w of prevWaves) {
        waveMap.set(w.wave, { ...w, agents: [] })
      }
      for (const a of agents) {
        if (!waveMap.has(a.wave)) {
          waveMap.set(a.wave, { wave: a.wave, agents: [], complete: false })
        }
        waveMap.get(a.wave)!.agents.push(a)
      }
      return Array.from(waveMap.values()).sort((a, b) => a.wave - b.wave)
    }

    es.addEventListener('scaffold_started', () => {
      setState(prev => ({ ...prev, scaffoldStatus: 'running', scaffoldOutput: '' }))
    })

    es.addEventListener('scaffold_output', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { chunk: string }
      setState(prev => ({ ...prev, scaffoldOutput: prev.scaffoldOutput + data.chunk }))
    })

    es.addEventListener('scaffold_complete', () => {
      setState(prev => ({ ...prev, scaffoldStatus: 'complete' }))
    })

    es.addEventListener('scaffold_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { error: string }
      setState(prev => ({ ...prev, scaffoldStatus: 'failed', error: data.error }))
    })

    es.addEventListener('agent_started', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { agent: string; wave: number; files: string[] }
      setState(prev =>
        upsertAgent(prev, data.agent, data.wave, {
          status: 'running',
          files: data.files,
          startedAt: Date.now(),
        })
      )
    })

    es.addEventListener('agent_complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as {
        agent: string
        wave: number
        status: string
        branch: string
      }
      setState(prev =>
        upsertAgent(prev, data.agent, data.wave, {
          status: 'complete',
          branch: data.branch,
        })
      )
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
      setState(prev =>
        upsertAgent(prev, data.agent, data.wave, {
          status: 'failed',
          failure_type: data.failure_type,
          notes: data.notes,
          message: data.message,
        })
      )
    })

    es.addEventListener('agent_output', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as AgentOutputData
      setState(prev => {
        const existing = prev.agents.find(a => a.agent === data.agent && a.wave === data.wave)
        const prevOutput = existing?.output ?? ''
        return upsertAgent(prev, data.agent, data.wave, { output: prevOutput + data.chunk })
      })
    })

    es.addEventListener('agent_tool_call', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as AgentToolCallData
      setState(prev => {
        const existing = prev.agents.find(a => a.agent === data.agent && a.wave === data.wave)
        const prevCalls: ToolCallEntry[] = existing?.toolCalls ?? []

        let updatedCalls: ToolCallEntry[]
        if (data.is_result) {
          // Update the matching tool_use entry with duration + status
          updatedCalls = prevCalls.map(tc =>
            tc.tool_id === data.tool_id
              ? { ...tc, duration_ms: data.duration_ms, is_error: data.is_error, status: data.is_error ? 'error' : 'done' }
              : tc
          )
        } else {
          // New tool_use — prepend (newest first), cap at 50
          const entry: ToolCallEntry = {
            tool_id: data.tool_id,
            tool_name: data.tool_name,
            input: data.input,
            started_at: Date.now(),
            status: 'running',
          }
          updatedCalls = [entry, ...prevCalls].slice(0, 50)
        }

        return upsertAgent(prev, data.agent, data.wave, { toolCalls: updatedCalls })
      })
    })

    es.addEventListener('wave_complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { wave: number; merge_status: string }
      setState(prev => {
        const waves = prev.waves.map(w =>
          w.wave === data.wave ? { ...w, complete: true, merge_status: data.merge_status } : w
        )
        return { ...prev, waves }
      })
    })

    es.addEventListener('run_complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { status: string; waves: number; agents: number }
      setState(prev => ({ ...prev, runComplete: true, runStatus: data.status }))
    })

    es.addEventListener('run_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { error: string }
      setState(prev => {
        // Mark any agents still pending/running as failed
        const updatedAgents = prev.agents.map(a =>
          a.status === 'pending' || a.status === 'running'
            ? { ...a, status: 'failed' as const, message: data.error }
            : a
        )
        const waves = buildWaves(updatedAgents, prev.waves)
        return { ...prev, agents: updatedAgents, waves, runFailed: data.error }
      })
    })

    es.addEventListener('wave_gate_pending', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { wave: number; next_wave: number; slug: string }
      setState(s => ({ ...s, waveGate: { wave: data.wave, nextWave: data.next_wave } }))
    })

    es.addEventListener('wave_gate_resolved', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { wave: number; action: string }
      void data // consumed for side-effect only
      setState(s => ({ ...s, waveGate: undefined }))
    })

    es.addEventListener('merge_started', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number }
      setState(prev => {
        const next = new Map(prev.wavesMergeState)
        next.set(data.wave, { status: 'merging', output: '', conflictingFiles: [], resolvedFiles: [] })
        return { ...prev, wavesMergeState: next }
      })
    })

    es.addEventListener('merge_output', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; chunk: string }
      setState(prev => {
        const next = new Map(prev.wavesMergeState)
        const cur = next.get(data.wave) ?? { status: 'merging' as const, output: '', conflictingFiles: [], resolvedFiles: [] }
        next.set(data.wave, { ...cur, output: cur.output + data.chunk })
        return { ...prev, wavesMergeState: next }
      })
    })

    es.addEventListener('merge_complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; status: string }
      setState(prev => {
        const next = new Map(prev.wavesMergeState)
        const cur = next.get(data.wave) ?? { status: 'idle' as const, output: '', conflictingFiles: [], resolvedFiles: [] }
        next.set(data.wave, { ...cur, status: 'success' })
        return { ...prev, wavesMergeState: next }
      })
    })

    es.addEventListener('merge_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; error: string; conflicting_files: string[] }
      setState(prev => {
        const next = new Map(prev.wavesMergeState)
        const cur = next.get(data.wave) ?? { status: 'idle' as const, output: '', conflictingFiles: [], resolvedFiles: [] }
        next.set(data.wave, { ...cur, status: 'failed', error: data.error, conflictingFiles: data.conflicting_files ?? [] })
        return { ...prev, wavesMergeState: next }
      })
    })

    es.addEventListener('conflict_resolving', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; file: string }
      setState(prev => {
        const next = new Map(prev.wavesMergeState)
        const cur = next.get(data.wave) ?? { status: 'idle' as const, output: '', conflictingFiles: [], resolvedFiles: [] }
        next.set(data.wave, { ...cur, status: 'resolving', resolvingFile: data.file })
        return { ...prev, wavesMergeState: next }
      })
    })

    es.addEventListener('conflict_resolved', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; file: string }
      setState(prev => {
        const next = new Map(prev.wavesMergeState)
        const cur = next.get(data.wave) ?? { status: 'idle' as const, output: '', conflictingFiles: [], resolvedFiles: [] }
        next.set(data.wave, { ...cur, resolvedFiles: [...cur.resolvedFiles, data.file] })
        return { ...prev, wavesMergeState: next }
      })
    })

    es.addEventListener('conflict_resolution_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; file: string; error: string }
      setState(prev => {
        const next = new Map(prev.wavesMergeState)
        const cur = next.get(data.wave) ?? { status: 'idle' as const, output: '', conflictingFiles: [], resolvedFiles: [] }
        next.set(data.wave, { ...cur, status: 'failed', resolutionError: data.error, failedFile: data.file })
        return { ...prev, wavesMergeState: next }
      })
    })

    es.addEventListener('test_started', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number }
      setState(prev => {
        const next = new Map(prev.wavesTestState)
        next.set(data.wave, { status: 'running', output: '' })
        return { ...prev, wavesTestState: next }
      })
    })

    es.addEventListener('test_output', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; chunk: string }
      setState(prev => {
        const next = new Map(prev.wavesTestState)
        const cur = next.get(data.wave) ?? { status: 'running' as const, output: '' }
        next.set(data.wave, { ...cur, output: cur.output + data.chunk })
        return { ...prev, wavesTestState: next }
      })
    })

    es.addEventListener('test_complete', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; status: string }
      setState(prev => {
        const next = new Map(prev.wavesTestState)
        const cur = next.get(data.wave) ?? { status: 'idle' as const, output: '' }
        next.set(data.wave, { ...cur, status: 'pass' })
        return { ...prev, wavesTestState: next }
      })
    })

    es.addEventListener('test_failed', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as { slug: string; wave: number; status: string; output: string }
      setState(prev => {
        const next = new Map(prev.wavesTestState)
        const cur = next.get(data.wave) ?? { status: 'idle' as const, output: '' }
        next.set(data.wave, { ...cur, status: 'fail', output: data.output })
        return { ...prev, wavesTestState: next }
      })
    })

    es.addEventListener('stale_branches_detected', (event: MessageEvent) => {
      const data = JSON.parse(event.data) as StaleBranchesInfo
      setState(prev => ({ ...prev, staleBranches: data }))
    })

    es.addEventListener('stage_transition', (event: MessageEvent) => {
      const entry = JSON.parse(event.data) as StageEntry
      setState(prev => {
        // Update existing running entry for same stage+wave, or append new.
        const idx = prev.stageEntries.findIndex(
          e => e.stage === entry.stage && e.wave_num === entry.wave_num && e.status === 'running'
        )
        if (idx >= 0 && entry.status !== 'running') {
          const next = [...prev.stageEntries]
          next[idx] = entry
          return { ...prev, stageEntries: next }
        }
        return { ...prev, stageEntries: [...prev.stageEntries, entry] }
      })
    })

    return () => {
      esRef.current?.close()
    }
  }, [slug])

  return state
}
