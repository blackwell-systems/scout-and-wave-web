// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useExecutionSync } from './useExecutionSync'
import type { AppWaveState } from './useWaveEvents'

// Mock useWaveEvents so we can control the returned state
vi.mock('./useWaveEvents', () => ({
  useWaveEvents: vi.fn(),
}))

import { useWaveEvents } from './useWaveEvents'

const mockUseWaveEvents = useWaveEvents as ReturnType<typeof vi.fn>

function makeIdleState(overrides: Partial<AppWaveState> = {}): AppWaveState {
  return {
    agents: [],
    scaffoldStatus: 'idle',
    scaffoldOutput: '',
    runComplete: false,
    connected: false,
    waves: [],
    wavesMergeState: new Map(),
    wavesTestState: new Map(),
    stageEntries: [],
    ...overrides,
  }
}

beforeEach(() => {
  mockUseWaveEvents.mockReset()
  mockUseWaveEvents.mockReturnValue(makeIdleState())
})

describe('useExecutionSync', () => {
  it('TestIdleState — when slug is empty/undefined, returns empty maps and isLive=false', () => {
    const { result } = renderHook(() => useExecutionSync(undefined))
    expect(result.current.agents.size).toBe(0)
    expect(result.current.waveProgress.size).toBe(0)
    expect(result.current.scaffoldStatus).toBe('idle')
    expect(result.current.isLive).toBe(false)

    // Also test empty string
    mockUseWaveEvents.mockReturnValue(makeIdleState())
    const { result: result2 } = renderHook(() => useExecutionSync(''))
    expect(result2.current.agents.size).toBe(0)
    expect(result2.current.isLive).toBe(false)
  })

  it('TestAgentMapping — agents across 2 waves are keyed "wave:agent" with correct statuses', () => {
    const mockState = makeIdleState({
      connected: true,
      agents: [
        { agent: 'A', wave: 1, files: [], status: 'running' },
        { agent: 'B', wave: 2, files: [], status: 'complete' },
      ],
      waves: [
        { wave: 1, agents: [{ agent: 'A', wave: 1, files: [], status: 'running' }], complete: false },
        { wave: 2, agents: [{ agent: 'B', wave: 2, files: [], status: 'complete' }], complete: true },
      ],
    })
    mockUseWaveEvents.mockReturnValue(mockState)

    const { result } = renderHook(() => useExecutionSync('test-slug'))

    expect(result.current.agents.size).toBe(2)

    const agentA = result.current.agents.get('1:A')
    expect(agentA).toBeDefined()
    expect(agentA?.status).toBe('running')
    expect(agentA?.agent).toBe('A')
    expect(agentA?.wave).toBe(1)

    const agentB = result.current.agents.get('2:B')
    expect(agentB).toBeDefined()
    expect(agentB?.status).toBe('complete')
    expect(agentB?.agent).toBe('B')
    expect(agentB?.wave).toBe(2)
  })

  it('TestAgentMapping — failed agent includes failureType', () => {
    const mockState = makeIdleState({
      agents: [
        { agent: 'C', wave: 1, files: [], status: 'failed', failure_type: 'timeout' },
      ],
      waves: [
        { wave: 1, agents: [{ agent: 'C', wave: 1, files: [], status: 'failed', failure_type: 'timeout' }], complete: false },
      ],
    })
    mockUseWaveEvents.mockReturnValue(mockState)

    const { result } = renderHook(() => useExecutionSync('test-slug'))

    const agentC = result.current.agents.get('1:C')
    expect(agentC?.status).toBe('failed')
    expect(agentC?.failureType).toBe('timeout')
  })

  it('TestWaveProgress — 3 agents in wave 1 (1 complete, 2 running) → {complete: 1, total: 3}', () => {
    const wave1Agents = [
      { agent: 'A', wave: 1, files: [], status: 'complete' as const },
      { agent: 'B', wave: 1, files: [], status: 'running' as const },
      { agent: 'C', wave: 1, files: [], status: 'running' as const },
    ]
    const mockState = makeIdleState({
      agents: wave1Agents,
      waves: [
        { wave: 1, agents: wave1Agents, complete: false },
      ],
    })
    mockUseWaveEvents.mockReturnValue(mockState)

    const { result } = renderHook(() => useExecutionSync('test-slug'))

    const progress = result.current.waveProgress.get(1)
    expect(progress).toBeDefined()
    expect(progress?.complete).toBe(1)
    expect(progress?.total).toBe(3)
  })

  it('TestWaveProgress — mergeStatus is mapped from wavesMergeState', () => {
    const wave1Agents = [
      { agent: 'A', wave: 1, files: [], status: 'complete' as const },
    ]
    const wavesMergeState = new Map([[1, { status: 'merging' as const, output: '', conflictingFiles: [] }]])
    const mockState = makeIdleState({
      agents: wave1Agents,
      waves: [{ wave: 1, agents: wave1Agents, complete: false }],
      wavesMergeState,
    })
    mockUseWaveEvents.mockReturnValue(mockState)

    const { result } = renderHook(() => useExecutionSync('test-slug'))

    const progress = result.current.waveProgress.get(1)
    expect(progress?.mergeStatus).toBe('merging')
  })

  it('TestWaveProgress — mergeStatus is undefined when no entry in wavesMergeState', () => {
    const wave1Agents = [
      { agent: 'A', wave: 1, files: [], status: 'complete' as const },
    ]
    const mockState = makeIdleState({
      agents: wave1Agents,
      waves: [{ wave: 1, agents: wave1Agents, complete: false }],
      wavesMergeState: new Map(),
    })
    mockUseWaveEvents.mockReturnValue(mockState)

    const { result } = renderHook(() => useExecutionSync('test-slug'))

    const progress = result.current.waveProgress.get(1)
    expect(progress?.mergeStatus).toBeUndefined()
  })

  it('TestScaffoldPassthrough — scaffoldStatus flows through from useWaveEvents', () => {
    mockUseWaveEvents.mockReturnValue(makeIdleState({ scaffoldStatus: 'running' }))
    const { result } = renderHook(() => useExecutionSync('test-slug'))
    expect(result.current.scaffoldStatus).toBe('running')

    mockUseWaveEvents.mockReturnValue(makeIdleState({ scaffoldStatus: 'complete' }))
    const { result: result2 } = renderHook(() => useExecutionSync('test-slug'))
    expect(result2.current.scaffoldStatus).toBe('complete')

    // 'failed' maps to 'idle' (not in ExecutionSyncState's scaffold type)
    mockUseWaveEvents.mockReturnValue(makeIdleState({ scaffoldStatus: 'failed' }))
    const { result: result3 } = renderHook(() => useExecutionSync('test-slug'))
    expect(result3.current.scaffoldStatus).toBe('idle')
  })

  it('TestIsLive — connected + not runComplete = true', () => {
    // isLive also requires hasActiveWork (running/pending agent) to avoid false-live on completed IMPLs
    mockUseWaveEvents.mockReturnValue(makeIdleState({
      connected: true,
      runComplete: false,
      agents: [{ agent: 'A', wave: 1, status: 'running', files: [] }],
    }))
    const { result } = renderHook(() => useExecutionSync('test-slug'))
    expect(result.current.isLive).toBe(true)
  })

  it('TestIsLive — runComplete = true → isLive = false', () => {
    mockUseWaveEvents.mockReturnValue(makeIdleState({ connected: true, runComplete: true }))
    const { result } = renderHook(() => useExecutionSync('test-slug'))
    expect(result.current.isLive).toBe(false)
  })

  it('TestIsLive — not connected → isLive = false', () => {
    mockUseWaveEvents.mockReturnValue(makeIdleState({ connected: false, runComplete: false }))
    const { result } = renderHook(() => useExecutionSync('test-slug'))
    expect(result.current.isLive).toBe(false)
  })

  it('TestIsLive — undefined slug → isLive = false even when state says connected', () => {
    mockUseWaveEvents.mockReturnValue(makeIdleState({ connected: true, runComplete: false }))
    const { result } = renderHook(() => useExecutionSync(undefined))
    expect(result.current.isLive).toBe(false)
  })
})
