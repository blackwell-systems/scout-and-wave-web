import { describe, it, expect } from 'vitest'
import { waveEventsReducer, initialWaveState, AppWaveState } from '../waveEventsReducer'

describe('PIPELINE_STEP reducer action', () => {
  it('adds a new pipeline step to pipelineSteps', () => {
    const state = { ...initialWaveState }
    const next = waveEventsReducer(state, {
      type: 'PIPELINE_STEP',
      step: 'verify_commits',
      status: 'running',
      wave: 1,
    })
    expect(next.pipelineSteps).toEqual({
      verify_commits: { status: 'running', error: undefined },
    })
  })

  it('updates an existing pipeline step', () => {
    const state: AppWaveState = {
      ...initialWaveState,
      pipelineSteps: {
        verify_commits: { status: 'running' },
      },
    }
    const next = waveEventsReducer(state, {
      type: 'PIPELINE_STEP',
      step: 'verify_commits',
      status: 'failed',
      wave: 1,
      error: 'commit missing',
    })
    expect(next.pipelineSteps).toEqual({
      verify_commits: { status: 'failed', error: 'commit missing' },
    })
  })

  it('preserves other steps when adding a new one', () => {
    const state: AppWaveState = {
      ...initialWaveState,
      pipelineSteps: {
        verify_commits: { status: 'complete' },
      },
    }
    const next = waveEventsReducer(state, {
      type: 'PIPELINE_STEP',
      step: 'scan_stubs',
      status: 'running',
      wave: 1,
    })
    expect(next.pipelineSteps).toEqual({
      verify_commits: { status: 'complete' },
      scan_stubs: { status: 'running', error: undefined },
    })
  })

  it('does not break existing state construction without pipelineSteps', () => {
    // Simulate SEED_DISK_STATUS which does not set pipelineSteps
    const state = waveEventsReducer(initialWaveState, {
      type: 'SEED_DISK_STATUS',
      agents: [],
      waves: [],
      scaffoldStatus: 'idle',
      mergedWaves: [],
    })
    // pipelineSteps should remain from initialWaveState
    expect(state.pipelineSteps).toEqual({})
    // Other fields should still work
    expect(state.agents).toEqual([])
    expect(state.scaffoldStatus).toBe('idle')
  })
})

describe('forceMarkComplete API shape', () => {
  it('sends POST to correct endpoint', async () => {
    const originalFetch = globalThis.fetch
    let capturedUrl = ''
    let capturedMethod = ''
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? 'GET'
      return new Response('{"status":"complete"}', { status: 200 })
    }
    try {
      const { forceMarkComplete } = await import('../../api')
      await forceMarkComplete('my-impl')
      expect(capturedUrl).toBe('/api/wave/my-impl/mark-complete')
      expect(capturedMethod).toBe('POST')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
