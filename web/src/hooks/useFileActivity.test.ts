import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useFileActivity } from './useFileActivity'
import type { AppWaveState } from './waveEventsReducer'
import type { AgentStatus } from '../types'

function makeTestState(agents: AgentStatus[]): AppWaveState {
  return {
    agents,
    scaffoldStatus: 'idle',
    scaffoldOutput: '',
    runComplete: false,
    connected: true,
    waves: [],
    wavesMergeState: new Map(),
    wavesTestState: new Map(),
    stageEntries: [],
    fixBuildStatus: 'idle',
    fixBuildOutput: '',
  }
}

describe('useFileActivity', () => {
  it('returns empty map when no agents', () => {
    const state = makeTestState([])
    const { result } = renderHook(() => useFileActivity(state))
    expect(result.current.size).toBe(0)
  })

  it('marks all files idle when agents are pending', () => {
    const state = makeTestState([
      {
        agent: 'agent-A',
        wave: 1,
        files: ['web/src/foo.ts', 'web/src/bar.tsx'],
        status: 'pending',
      },
    ])
    const { result } = renderHook(() => useFileActivity(state))
    expect(result.current.size).toBe(2)
    expect(result.current.get('web/src/foo.ts')?.status).toBe('idle')
    expect(result.current.get('web/src/bar.tsx')?.status).toBe('idle')
  })

  it('marks file as reading when agent has Read tool call', () => {
    const state = makeTestState([
      {
        agent: 'agent-A',
        wave: 1,
        files: ['web/src/foo.ts'],
        status: 'running',
        toolCalls: [
          {
            tool_id: 'tool1',
            tool_name: 'Read',
            input: '/abs/path/web/src/foo.ts',
            started_at: Date.now(),
            status: 'running',
          },
        ],
      },
    ])
    const { result } = renderHook(() => useFileActivity(state))
    const entry = result.current.get('web/src/foo.ts')
    expect(entry?.status).toBe('reading')
    expect(entry?.lastTool).toBe('Read')
  })

  it('marks file as writing when agent has Write tool call', () => {
    const state = makeTestState([
      {
        agent: 'agent-A',
        wave: 1,
        files: ['web/src/foo.ts'],
        status: 'running',
        toolCalls: [
          {
            tool_id: 'tool1',
            tool_name: 'Write',
            input: '/abs/path/web/src/foo.ts content here',
            started_at: Date.now(),
            status: 'running',
          },
        ],
      },
    ])
    const { result } = renderHook(() => useFileActivity(state))
    const entry = result.current.get('web/src/foo.ts')
    expect(entry?.status).toBe('writing')
    expect(entry?.lastTool).toBe('Write')
  })

  it('marks files as committed when agent is complete', () => {
    const state = makeTestState([
      {
        agent: 'agent-A',
        wave: 1,
        files: ['web/src/foo.ts', 'web/src/bar.tsx'],
        status: 'complete',
        branch: 'wave1-agent-A',
      },
    ])
    const { result } = renderHook(() => useFileActivity(state))
    expect(result.current.get('web/src/foo.ts')?.status).toBe('committed')
    expect(result.current.get('web/src/bar.tsx')?.status).toBe('committed')
  })

  it('writing takes priority over reading', () => {
    const state = makeTestState([
      {
        agent: 'agent-A',
        wave: 1,
        files: ['web/src/foo.ts'],
        status: 'running',
        toolCalls: [
          // Newest first (Write is first)
          {
            tool_id: 'tool2',
            tool_name: 'Write',
            input: '/abs/path/web/src/foo.ts new content',
            started_at: Date.now(),
            status: 'running',
          },
          {
            tool_id: 'tool1',
            tool_name: 'Read',
            input: '/abs/path/web/src/foo.ts',
            started_at: Date.now() - 1000,
            status: 'done',
          },
        ],
      },
    ])
    const { result } = renderHook(() => useFileActivity(state))
    const entry = result.current.get('web/src/foo.ts')
    expect(entry?.status).toBe('writing')
    expect(entry?.lastTool).toBe('Write')
  })

  it('handles suffix matching for absolute vs relative paths', () => {
    const state = makeTestState([
      {
        agent: 'agent-A',
        wave: 1,
        files: ['web/src/foo.ts'],
        status: 'running',
        toolCalls: [
          {
            tool_id: 'tool1',
            tool_name: 'Read',
            input: '/absolute/path/to/repo/web/src/foo.ts',
            started_at: Date.now(),
            status: 'running',
          },
        ],
      },
    ])
    const { result } = renderHook(() => useFileActivity(state))
    const entry = result.current.get('web/src/foo.ts')
    expect(entry?.status).toBe('reading')
  })

  it('handles Edit tool call as writing', () => {
    const state = makeTestState([
      {
        agent: 'agent-A',
        wave: 1,
        files: ['web/src/foo.ts'],
        status: 'running',
        toolCalls: [
          {
            tool_id: 'tool1',
            tool_name: 'Edit',
            input: '/abs/path/web/src/foo.ts old_string new_string',
            started_at: Date.now(),
            status: 'running',
          },
        ],
      },
    ])
    const { result } = renderHook(() => useFileActivity(state))
    const entry = result.current.get('web/src/foo.ts')
    expect(entry?.status).toBe('writing')
    expect(entry?.lastTool).toBe('Edit')
  })

  it('handles Glob and Grep as reading', () => {
    const state = makeTestState([
      {
        agent: 'agent-A',
        wave: 1,
        files: ['web/src/components/Foo.tsx', 'web/src/utils.ts'],
        status: 'running',
        toolCalls: [
          {
            tool_id: 'tool1',
            tool_name: 'Glob',
            input: 'web/src/components/Foo.tsx',
            started_at: Date.now(),
            status: 'running',
          },
          {
            tool_id: 'tool2',
            tool_name: 'Grep',
            input: 'import web/src/utils.ts',
            started_at: Date.now(),
            status: 'running',
          },
        ],
      },
    ])
    const { result } = renderHook(() => useFileActivity(state))
    expect(result.current.get('web/src/components/Foo.tsx')?.status).toBe('reading')
    expect(result.current.get('web/src/utils.ts')?.status).toBe('reading')
  })

  it('ignores tool calls for files not owned by agent', () => {
    const state = makeTestState([
      {
        agent: 'agent-A',
        wave: 1,
        files: ['web/src/foo.ts'],
        status: 'running',
        toolCalls: [
          {
            tool_id: 'tool1',
            tool_name: 'Read',
            input: '/abs/path/web/src/other.ts',
            started_at: Date.now(),
            status: 'running',
          },
        ],
      },
    ])
    const { result } = renderHook(() => useFileActivity(state))
    const entry = result.current.get('web/src/foo.ts')
    // Should remain idle since tool call is for a different file
    expect(entry?.status).toBe('idle')
  })

  it('handles multiple agents with different files', () => {
    const state = makeTestState([
      {
        agent: 'agent-A',
        wave: 1,
        files: ['web/src/foo.ts'],
        status: 'running',
        toolCalls: [
          {
            tool_id: 'tool1',
            tool_name: 'Write',
            input: 'web/src/foo.ts content',
            started_at: Date.now(),
            status: 'running',
          },
        ],
      },
      {
        agent: 'agent-B',
        wave: 1,
        files: ['web/src/bar.tsx'],
        status: 'complete',
        branch: 'wave1-agent-B',
      },
    ])
    const { result } = renderHook(() => useFileActivity(state))
    expect(result.current.get('web/src/foo.ts')?.status).toBe('writing')
    expect(result.current.get('web/src/bar.tsx')?.status).toBe('committed')
  })

  it('committed status overrides reading/writing for complete agents', () => {
    const state = makeTestState([
      {
        agent: 'agent-A',
        wave: 1,
        files: ['web/src/foo.ts'],
        status: 'complete',
        branch: 'wave1-agent-A',
        // Even if there are tool calls, complete status wins
        toolCalls: [
          {
            tool_id: 'tool1',
            tool_name: 'Write',
            input: 'web/src/foo.ts content',
            started_at: Date.now(),
            status: 'done',
          },
        ],
      },
    ])
    const { result } = renderHook(() => useFileActivity(state))
    expect(result.current.get('web/src/foo.ts')?.status).toBe('committed')
  })
})
