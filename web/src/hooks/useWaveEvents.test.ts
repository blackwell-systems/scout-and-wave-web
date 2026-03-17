import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useWaveEvents } from './useWaveEvents'
import * as api from '../api'

// Mock the API module
vi.mock('../api', () => ({
  fetchDiskWaveStatus: vi.fn(),
}))

describe('useWaveEvents', () => {
  let mockEventSource: {
    addEventListener: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    onopen: (() => void) | null
    onerror: (() => void) | null
  }
  let eventListeners: Record<string, ((event: MessageEvent) => void)[]>

  beforeEach(() => {
    eventListeners = {}
    mockEventSource = {
      addEventListener: vi.fn((event: string, handler: (event: MessageEvent) => void) => {
        if (!eventListeners[event]) {
          eventListeners[event] = []
        }
        eventListeners[event].push(handler)
      }),
      close: vi.fn(),
      onopen: null,
      onerror: null,
    }

    // Mock EventSource constructor - must be a function
    const EventSourceMock = function(this: any) {
      return mockEventSource
    } as any
    vi.stubGlobal('EventSource', EventSourceMock)

    // Mock fetchDiskWaveStatus to resolve with empty data
    vi.mocked(api.fetchDiskWaveStatus).mockResolvedValue({
      agents: [],
      waves_merged: [],
      scaffold_status: 'none',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  // Helper to fire a mock SSE event
  async function fireEvent(eventType: string, data: unknown) {
    const handlers = eventListeners[eventType] || []
    const event = {
      data: JSON.stringify(data),
      type: eventType,
    } as MessageEvent
    handlers.forEach(handler => handler(event))
    // Give React time to process the state update
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  it('returns initial state on mount', () => {
    const { result } = renderHook(() => useWaveEvents('test-slug'))
    
    expect(result.current.agents).toEqual([])
    expect(result.current.scaffoldStatus).toBe('idle')
    expect(result.current.scaffoldOutput).toBe('')
    expect(result.current.runComplete).toBe(false)
    expect(result.current.connected).toBe(false)
    expect(result.current.waves).toEqual([])
    expect(result.current.fixBuildStatus).toBe('idle')
    expect(result.current.fixBuildOutput).toBe('')
  })

  it('sets connected to true when EventSource opens', async () => {
    const { result } = renderHook(() => useWaveEvents('test-slug'))
    
    // Trigger onopen
    mockEventSource.onopen?.()
    
    await waitFor(() => {
      expect(result.current.connected).toBe(true)
    })
  })

  it('dispatches agent_started and updates state', async () => {
    const { result } = renderHook(() => useWaveEvents('test-slug'))
    
    // Wait for EventSource to be set up
    await new Promise(resolve => setTimeout(resolve, 10))
    
    await fireEvent('agent_started', {
      agent: 'agent-a',
      wave: 1,
      files: ['file1.ts', 'file2.ts'],
    })
    
    await waitFor(() => {
      expect(result.current.agents).toHaveLength(1)
      expect(result.current.agents[0].agent).toBe('agent-a')
      expect(result.current.agents[0].wave).toBe(1)
      expect(result.current.agents[0].status).toBe('running')
      expect(result.current.agents[0].files).toEqual(['file1.ts', 'file2.ts'])
    })
  })

  it('dispatches agent_complete and updates state', async () => {
    const { result } = renderHook(() => useWaveEvents('test-slug'))
    
    // Wait for EventSource to be set up
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Start agent first
    await fireEvent('agent_started', {
      agent: 'agent-a',
      wave: 1,
      files: ['file1.ts'],
    })
    
    await waitFor(() => {
      expect(result.current.agents[0].status).toBe('running')
    })

    // Complete agent
    await fireEvent('agent_complete', {
      agent: 'agent-a',
      wave: 1,
      status: 'complete',
      branch: 'wave-1-agent-a',
    })
    
    await waitFor(() => {
      expect(result.current.agents[0].status).toBe('complete')
      expect(result.current.agents[0].branch).toBe('wave-1-agent-a')
    })
  })

  it('dispatches agent_failed and updates state', async () => {
    const { result } = renderHook(() => useWaveEvents('test-slug'))
    
    // Wait for EventSource to be set up
    await new Promise(resolve => setTimeout(resolve, 10))
    
    await fireEvent('agent_started', {
      agent: 'agent-b',
      wave: 2,
      files: ['file3.ts'],
    })
    
    await fireEvent('agent_failed', {
      agent: 'agent-b',
      wave: 2,
      status: 'failed',
      failure_type: 'test_failure',
      message: 'Tests failed',
    })
    
    await waitFor(() => {
      expect(result.current.agents[0].status).toBe('failed')
      expect(result.current.agents[0].failure_type).toBe('test_failure')
      expect(result.current.agents[0].message).toBe('Tests failed')
    })
  })

  it('dispatches run_complete and sets runComplete', async () => {
    const { result } = renderHook(() => useWaveEvents('test-slug'))
    
    await fireEvent('run_complete', {
      status: 'success',
      waves: 3,
      agents: 6,
    })
    
    await waitFor(() => {
      expect(result.current.runComplete).toBe(true)
      expect(result.current.runStatus).toBe('success')
    })
  })

  it('dispatches scaffold events correctly', async () => {
    const { result } = renderHook(() => useWaveEvents('test-slug'))
    
    // Wait for EventSource to be set up
    await new Promise(resolve => setTimeout(resolve, 10))
    
    await fireEvent('scaffold_started', {})
    
    await waitFor(() => {
      expect(result.current.scaffoldStatus).toBe('running')
    })

    await fireEvent('scaffold_output', { chunk: 'Installing dependencies...\n' })
    
    await waitFor(() => {
      expect(result.current.scaffoldOutput).toBe('Installing dependencies...\n')
    })

    await fireEvent('scaffold_output', { chunk: 'Done.\n' })
    
    await waitFor(() => {
      expect(result.current.scaffoldOutput).toBe('Installing dependencies...\nDone.\n')
    })

    await fireEvent('scaffold_complete', {})
    
    await waitFor(() => {
      expect(result.current.scaffoldStatus).toBe('complete')
    })
  })

  it('dispatches merge events correctly', async () => {
    const { result } = renderHook(() => useWaveEvents('test-slug'))
    
    await fireEvent('merge_started', { slug: 'test-slug', wave: 1 })
    
    await waitFor(() => {
      const mergeState = result.current.wavesMergeState.get(1)
      expect(mergeState?.status).toBe('merging')
    })

    await fireEvent('merge_output', { slug: 'test-slug', wave: 1, chunk: 'Merging...\n' })
    
    await waitFor(() => {
      const mergeState = result.current.wavesMergeState.get(1)
      expect(mergeState?.output).toBe('Merging...\n')
    })

    await fireEvent('merge_complete', { slug: 'test-slug', wave: 1, status: 'success' })
    
    await waitFor(() => {
      const mergeState = result.current.wavesMergeState.get(1)
      expect(mergeState?.status).toBe('success')
    })
  })

  it('dispatches test events correctly', async () => {
    const { result } = renderHook(() => useWaveEvents('test-slug'))
    
    await fireEvent('test_started', { slug: 'test-slug', wave: 1 })
    
    await waitFor(() => {
      const testState = result.current.wavesTestState.get(1)
      expect(testState?.status).toBe('running')
    })

    await fireEvent('test_output', { slug: 'test-slug', wave: 1, chunk: 'Running tests...\n' })
    
    await waitFor(() => {
      const testState = result.current.wavesTestState.get(1)
      expect(testState?.output).toBe('Running tests...\n')
    })

    await fireEvent('test_complete', { slug: 'test-slug', wave: 1, status: 'pass' })
    
    await waitFor(() => {
      const testState = result.current.wavesTestState.get(1)
      expect(testState?.status).toBe('pass')
    })
  })

  it('closes EventSource on unmount', () => {
    const { unmount } = renderHook(() => useWaveEvents('test-slug'))
    
    expect(mockEventSource.close).not.toHaveBeenCalled()
    
    unmount()
    
    expect(mockEventSource.close).toHaveBeenCalledOnce()
  })

  it('dispatches agent_output and accumulates output', async () => {
    const { result } = renderHook(() => useWaveEvents('test-slug'))
    
    // Wait for EventSource to be set up
    await new Promise(resolve => setTimeout(resolve, 10))
    
    await fireEvent('agent_started', {
      agent: 'agent-c',
      wave: 1,
      files: [],
    })

    await fireEvent('agent_output', {
      agent: 'agent-c',
      wave: 1,
      chunk: 'Line 1\n',
    })
    
    await waitFor(() => {
      expect(result.current.agents[0].output).toBe('Line 1\n')
    })

    await fireEvent('agent_output', {
      agent: 'agent-c',
      wave: 1,
      chunk: 'Line 2\n',
    })
    
    await waitFor(() => {
      expect(result.current.agents[0].output).toBe('Line 1\nLine 2\n')
    })
  })

  it('dispatches wave_complete and marks wave as complete', async () => {
    const { result } = renderHook(() => useWaveEvents('test-slug'))
    
    // Wait for EventSource to be set up
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Start an agent to create a wave
    await fireEvent('agent_started', {
      agent: 'agent-a',
      wave: 1,
      files: [],
    })
    
    await waitFor(() => {
      expect(result.current.waves).toHaveLength(1)
    })

    await fireEvent('wave_complete', {
      wave: 1,
      merge_status: 'success',
    })
    
    await waitFor(() => {
      expect(result.current.waves[0].complete).toBe(true)
      expect(result.current.waves[0].merge_status).toBe('success')
    })
  })

  it('dispatches run_failed and marks pending agents as failed', async () => {
    const { result } = renderHook(() => useWaveEvents('test-slug'))
    
    // Wait for EventSource to be set up
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Add some agents
    await fireEvent('agent_started', {
      agent: 'agent-a',
      wave: 1,
      files: [],
    })

    await waitFor(() => {
      expect(result.current.agents).toHaveLength(1)
    })
    
    await fireEvent('agent_started', {
      agent: 'agent-b',
      wave: 1,
      files: [],
    })

    await waitFor(() => {
      expect(result.current.agents).toHaveLength(2)
    })

    // Complete one agent
    await fireEvent('agent_complete', {
      agent: 'agent-a',
      wave: 1,
      status: 'complete',
      branch: 'wave-1-agent-a',
    })

    await waitFor(() => {
      expect(result.current.agents[0].status).toBe('complete')
    })

    // Fail the run
    await fireEvent('run_failed', {
      error: 'Run terminated',
    })
    
    await waitFor(() => {
      expect(result.current.runFailed).toBe('Run terminated')
      // agent-a should stay complete
      expect(result.current.agents[0].status).toBe('complete')
      // agent-b should be marked failed
      expect(result.current.agents[1].status).toBe('failed')
      expect(result.current.agents[1].message).toBe('Run terminated')
    })
  })

  it('seeds state from disk status on mount', async () => {
    vi.mocked(api.fetchDiskWaveStatus).mockResolvedValue({
      agents: [
        {
          agent: 'agent-disk',
          wave: 1,
          status: 'complete',
          files: ['file.ts'],
          branch: 'wave-1-agent-disk',
        },
      ],
      waves_merged: [1],
      scaffold_status: 'committed',
    })

    const { result } = renderHook(() => useWaveEvents('test-slug'))
    
    await waitFor(() => {
      expect(result.current.agents).toHaveLength(1)
      expect(result.current.agents[0].agent).toBe('agent-disk')
      expect(result.current.agents[0].status).toBe('complete')
      expect(result.current.scaffoldStatus).toBe('complete')
      expect(result.current.wavesMergeState.get(1)?.status).toBe('success')
    })
  })
})
