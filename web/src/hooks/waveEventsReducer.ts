import { AgentStatus, ToolCallEntry, WaveState } from '../types'

// Re-exported types for backward compatibility
export interface WaveMergeState {
  status: 'idle' | 'merging' | 'success' | 'failed' | 'resolving'
  output: string
  conflictingFiles: string[]
  error?: string
  resolvingFile?: string
  resolvedFiles: string[]
  failedFile?: string
  resolutionError?: string
}

export interface WaveTestState {
  status: 'idle' | 'running' | 'pass' | 'fail'
  output: string
}

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
  fixBuildStatus: 'idle' | 'running' | 'complete' | 'failed'
  fixBuildOutput: string
  fixBuildError?: string
}

// Action types
export type WaveAction =
  | { type: 'CONNECT' }
  | { type: 'DISCONNECT'; error?: string }
  | { type: 'SEED_DISK_STATUS'; agents: AgentStatus[]; waves: WaveState[]; scaffoldStatus: AppWaveState['scaffoldStatus']; mergedWaves: number[] }
  | { type: 'SCAFFOLD_STARTED' }
  | { type: 'SCAFFOLD_OUTPUT'; chunk: string }
  | { type: 'SCAFFOLD_COMPLETE' }
  | { type: 'SCAFFOLD_FAILED'; error: string }
  | { type: 'AGENT_STARTED'; agent: string; wave: number; files: string[] }
  | { type: 'AGENT_COMPLETE'; agent: string; wave: number; branch: string }
  | { type: 'AGENT_FAILED'; agent: string; wave: number; failure_type: string; notes?: string; message: string }
  | { type: 'AGENT_OUTPUT'; agent: string; wave: number; chunk: string }
  | { type: 'AGENT_TOOL_CALL'; agent: string; wave: number; tool_id: string; tool_name: string; input: string; is_result: boolean; is_error: boolean; duration_ms: number }
  | { type: 'WAVE_COMPLETE'; wave: number; merge_status: string }
  | { type: 'RUN_COMPLETE'; status: string }
  | { type: 'RUN_FAILED'; error: string }
  | { type: 'WAVE_GATE_PENDING'; wave: number; next_wave: number }
  | { type: 'WAVE_GATE_RESOLVED' }
  | { type: 'MERGE_STARTED'; wave: number }
  | { type: 'MERGE_OUTPUT'; wave: number; chunk: string }
  | { type: 'MERGE_COMPLETE'; wave: number }
  | { type: 'MERGE_FAILED'; wave: number; error: string; conflicting_files: string[] }
  | { type: 'CONFLICT_RESOLVING'; wave: number; file: string }
  | { type: 'CONFLICT_RESOLVED'; wave: number; file: string }
  | { type: 'CONFLICT_RESOLUTION_FAILED'; wave: number; file: string; error: string }
  | { type: 'TEST_STARTED'; wave: number }
  | { type: 'TEST_OUTPUT'; wave: number; chunk: string }
  | { type: 'TEST_COMPLETE'; wave: number }
  | { type: 'TEST_FAILED'; wave: number; output: string }
  | { type: 'STALE_BRANCHES_DETECTED'; slug: string; branches: string[]; count: number }
  | { type: 'STAGE_TRANSITION'; entry: StageEntry }
  | { type: 'FIX_BUILD_STARTED' }
  | { type: 'FIX_BUILD_OUTPUT'; chunk: string }
  | { type: 'FIX_BUILD_COMPLETE' }
  | { type: 'FIX_BUILD_FAILED'; error: string }

// Initial state
export const initialWaveState: AppWaveState = {
  agents: [],
  scaffoldStatus: 'idle',
  scaffoldOutput: '',
  runComplete: false,
  connected: false,
  waves: [],
  wavesMergeState: new Map(),
  wavesTestState: new Map(),
  stageEntries: [],
  fixBuildStatus: 'idle',
  fixBuildOutput: '',
}

// Helper function: rebuild waves from agents list
export function buildWaves(agents: AgentStatus[], prevWaves: WaveState[]): WaveState[] {
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

// Helper function: upsert an agent into the agents list
function upsertAgent(
  state: AppWaveState,
  agent: string,
  wave: number,
  update: Partial<AgentStatus>
): AppWaveState {
  const existing = state.agents.find(a => a.agent === agent && a.wave === wave)
  let updatedAgents: AgentStatus[]
  if (existing) {
    updatedAgents = state.agents.map(a =>
      a.agent === agent && a.wave === wave ? { ...a, ...update } : a
    )
  } else {
    updatedAgents = [
      ...state.agents,
      { agent, wave, files: [], status: 'pending', ...update } as AgentStatus,
    ]
  }
  // Rebuild waves from agents
  const waves = buildWaves(updatedAgents, state.waves)
  return { ...state, agents: updatedAgents, waves }
}

// Reducer
export function waveEventsReducer(state: AppWaveState, action: WaveAction): AppWaveState {
  switch (action.type) {
    case 'CONNECT':
      return { ...state, connected: true, error: undefined }

    case 'DISCONNECT':
      return { ...state, connected: false, error: action.error ?? 'Connection lost' }

    case 'SEED_DISK_STATUS': {
      const mergeState = new Map(state.wavesMergeState)
      for (const w of action.mergedWaves) {
        if (!mergeState.has(w)) {
          mergeState.set(w, { status: 'success', output: '', conflictingFiles: [], resolvedFiles: [] })
        }
      }
      return {
        ...state,
        agents: action.agents,
        waves: action.waves,
        scaffoldStatus: action.scaffoldStatus,
        wavesMergeState: mergeState,
      }
    }

    case 'SCAFFOLD_STARTED':
      return { ...state, scaffoldStatus: 'running', scaffoldOutput: '' }

    case 'SCAFFOLD_OUTPUT':
      return { ...state, scaffoldOutput: state.scaffoldOutput + action.chunk }

    case 'SCAFFOLD_COMPLETE':
      return { ...state, scaffoldStatus: 'complete' }

    case 'SCAFFOLD_FAILED':
      return { ...state, scaffoldStatus: 'failed', error: action.error }

    case 'AGENT_STARTED':
      return upsertAgent(state, action.agent, action.wave, {
        status: 'running',
        files: action.files,
        startedAt: Date.now(),
      })

    case 'AGENT_COMPLETE':
      return upsertAgent(state, action.agent, action.wave, {
        status: 'complete',
        branch: action.branch,
      })

    case 'AGENT_FAILED':
      return upsertAgent(state, action.agent, action.wave, {
        status: 'failed',
        failure_type: action.failure_type,
        notes: action.notes,
        message: action.message,
      })

    case 'AGENT_OUTPUT': {
      const existing = state.agents.find(a => a.agent === action.agent && a.wave === action.wave)
      const prevOutput = existing?.output ?? ''
      return upsertAgent(state, action.agent, action.wave, { output: prevOutput + action.chunk })
    }

    case 'AGENT_TOOL_CALL': {
      const existing = state.agents.find(a => a.agent === action.agent && a.wave === action.wave)
      const prevCalls: ToolCallEntry[] = existing?.toolCalls ?? []

      let updatedCalls: ToolCallEntry[]
      if (action.is_result) {
        // Update the matching tool_use entry with duration + status
        updatedCalls = prevCalls.map(tc =>
          tc.tool_id === action.tool_id
            ? { ...tc, duration_ms: action.duration_ms, is_error: action.is_error, status: action.is_error ? 'error' : 'done' }
            : tc
        )
      } else {
        // New tool_use — prepend (newest first), cap at 50
        const entry: ToolCallEntry = {
          tool_id: action.tool_id,
          tool_name: action.tool_name,
          input: action.input,
          started_at: Date.now(),
          status: 'running',
        }
        updatedCalls = [entry, ...prevCalls].slice(0, 50)
      }

      return upsertAgent(state, action.agent, action.wave, { toolCalls: updatedCalls })
    }

    case 'WAVE_COMPLETE': {
      const waves = state.waves.map(w =>
        w.wave === action.wave ? { ...w, complete: true, merge_status: action.merge_status } : w
      )
      return { ...state, waves }
    }

    case 'RUN_COMPLETE':
      return { ...state, runComplete: true, runStatus: action.status }

    case 'RUN_FAILED': {
      // Mark any agents still pending/running as failed
      const updatedAgents = state.agents.map(a =>
        a.status === 'pending' || a.status === 'running'
          ? { ...a, status: 'failed' as const, message: action.error }
          : a
      )
      const waves = buildWaves(updatedAgents, state.waves)
      return { ...state, agents: updatedAgents, waves, runFailed: action.error }
    }

    case 'WAVE_GATE_PENDING':
      return { ...state, waveGate: { wave: action.wave, nextWave: action.next_wave } }

    case 'WAVE_GATE_RESOLVED':
      return { ...state, waveGate: undefined }

    case 'MERGE_STARTED': {
      const next = new Map(state.wavesMergeState)
      next.set(action.wave, { status: 'merging', output: '', conflictingFiles: [], resolvedFiles: [] })
      return { ...state, wavesMergeState: next }
    }

    case 'MERGE_OUTPUT': {
      const next = new Map(state.wavesMergeState)
      const cur = next.get(action.wave) ?? { status: 'merging' as const, output: '', conflictingFiles: [], resolvedFiles: [] }
      next.set(action.wave, { ...cur, output: cur.output + action.chunk })
      return { ...state, wavesMergeState: next }
    }

    case 'MERGE_COMPLETE': {
      const next = new Map(state.wavesMergeState)
      const cur = next.get(action.wave) ?? { status: 'idle' as const, output: '', conflictingFiles: [], resolvedFiles: [] }
      next.set(action.wave, { ...cur, status: 'success' })
      return { ...state, wavesMergeState: next }
    }

    case 'MERGE_FAILED': {
      const next = new Map(state.wavesMergeState)
      const cur = next.get(action.wave) ?? { status: 'idle' as const, output: '', conflictingFiles: [], resolvedFiles: [] }
      next.set(action.wave, { ...cur, status: 'failed', error: action.error, conflictingFiles: action.conflicting_files ?? [] })
      return { ...state, wavesMergeState: next }
    }

    case 'CONFLICT_RESOLVING': {
      const next = new Map(state.wavesMergeState)
      const cur = next.get(action.wave) ?? { status: 'idle' as const, output: '', conflictingFiles: [], resolvedFiles: [] }
      next.set(action.wave, { ...cur, status: 'resolving', resolvingFile: action.file })
      return { ...state, wavesMergeState: next }
    }

    case 'CONFLICT_RESOLVED': {
      const next = new Map(state.wavesMergeState)
      const cur = next.get(action.wave) ?? { status: 'idle' as const, output: '', conflictingFiles: [], resolvedFiles: [] }
      next.set(action.wave, { ...cur, resolvedFiles: [...cur.resolvedFiles, action.file] })
      return { ...state, wavesMergeState: next }
    }

    case 'CONFLICT_RESOLUTION_FAILED': {
      const next = new Map(state.wavesMergeState)
      const cur = next.get(action.wave) ?? { status: 'idle' as const, output: '', conflictingFiles: [], resolvedFiles: [] }
      next.set(action.wave, { ...cur, status: 'failed', resolutionError: action.error, failedFile: action.file })
      return { ...state, wavesMergeState: next }
    }

    case 'TEST_STARTED': {
      const next = new Map(state.wavesTestState)
      next.set(action.wave, { status: 'running', output: '' })
      return { ...state, wavesTestState: next }
    }

    case 'TEST_OUTPUT': {
      const next = new Map(state.wavesTestState)
      const cur = next.get(action.wave) ?? { status: 'running' as const, output: '' }
      next.set(action.wave, { ...cur, output: cur.output + action.chunk })
      return { ...state, wavesTestState: next }
    }

    case 'TEST_COMPLETE': {
      const next = new Map(state.wavesTestState)
      const cur = next.get(action.wave) ?? { status: 'idle' as const, output: '' }
      next.set(action.wave, { ...cur, status: 'pass' })
      return { ...state, wavesTestState: next }
    }

    case 'TEST_FAILED': {
      const next = new Map(state.wavesTestState)
      const cur = next.get(action.wave) ?? { status: 'idle' as const, output: '' }
      next.set(action.wave, { ...cur, status: 'fail', output: action.output })
      return { ...state, wavesTestState: next }
    }

    case 'STALE_BRANCHES_DETECTED':
      return { ...state, staleBranches: { slug: action.slug, branches: action.branches, count: action.count } }

    case 'STAGE_TRANSITION': {
      // Update existing running entry for same stage+wave, or append new.
      const idx = state.stageEntries.findIndex(
        e => e.stage === action.entry.stage && e.wave_num === action.entry.wave_num && e.status === 'running'
      )
      if (idx >= 0 && action.entry.status !== 'running') {
        const next = [...state.stageEntries]
        next[idx] = action.entry
        return { ...state, stageEntries: next }
      }
      return { ...state, stageEntries: [...state.stageEntries, action.entry] }
    }

    case 'FIX_BUILD_STARTED':
      return { ...state, fixBuildStatus: 'running', fixBuildOutput: '', fixBuildError: undefined }

    case 'FIX_BUILD_OUTPUT':
      return { ...state, fixBuildOutput: state.fixBuildOutput + action.chunk }

    case 'FIX_BUILD_COMPLETE':
      return { ...state, fixBuildStatus: 'complete' }

    case 'FIX_BUILD_FAILED':
      return { ...state, fixBuildStatus: 'failed', fixBuildError: action.error }

    default:
      return state
  }
}
