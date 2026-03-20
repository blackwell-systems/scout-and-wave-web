/**
 * Tests for the SawClient API layer.
 *
 * Validates:
 * 1. Shape: the client object has all expected namespaces and methods.
 * 2. URLs: representative methods call fetch with the correct URL and method.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHttpClient, sawClient } from './apiClient'
import type { SawClient } from './apiClient'

// ── Mock fetch globally ─────────────────────────────────────────────────────

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

function okJson(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response
}

function okText(text: string): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(text),
  } as unknown as Response
}

beforeEach(() => {
  mockFetch.mockReset()
})

// ── Shape tests ─────────────────────────────────────────────────────────────

describe('SawClient shape', () => {
  const client = createHttpClient()

  it('exports a default singleton', () => {
    expect(sawClient).toBeDefined()
    expect(typeof sawClient.impl.list).toBe('function')
  })

  it('has impl namespace with all methods', () => {
    expect(typeof client.impl.list).toBe('function')
    expect(typeof client.impl.get).toBe('function')
    expect(typeof client.impl.getRaw).toBe('function')
    expect(typeof client.impl.saveRaw).toBe('function')
    expect(typeof client.impl.approve).toBe('function')
    expect(typeof client.impl.reject).toBe('function')
    expect(typeof client.impl.delete).toBe('function')
    expect(typeof client.impl.revise).toBe('function')
    expect(typeof client.impl.subscribeReviseEvents).toBe('function')
    expect(typeof client.impl.chat).toBe('function')
    expect(typeof client.impl.subscribeChatEvents).toBe('function')
    expect(typeof client.impl.criticReview).toBe('function')
    expect(typeof client.impl.runCritic).toBe('function')
    expect(typeof client.impl.fetchAgentContext).toBe('function')
    expect(typeof client.impl.diff).toBe('function')
    // nested worktrees
    expect(typeof client.impl.worktrees.list).toBe('function')
    expect(typeof client.impl.worktrees.delete).toBe('function')
    expect(typeof client.impl.worktrees.batchDelete).toBe('function')
  })

  it('has wave namespace with all methods', () => {
    expect(typeof client.wave.start).toBe('function')
    expect(typeof client.wave.mergeWave).toBe('function')
    expect(typeof client.wave.mergeAbort).toBe('function')
    expect(typeof client.wave.runTests).toBe('function')
    expect(typeof client.wave.resolveConflicts).toBe('function')
    expect(typeof client.wave.rerunAgent).toBe('function')
    expect(typeof client.wave.retryFinalize).toBe('function')
    expect(typeof client.wave.fixBuild).toBe('function')
    expect(typeof client.wave.proceedGate).toBe('function')
    expect(typeof client.wave.diskStatus).toBe('function')
    expect(typeof client.wave.subscribeEvents).toBe('function')
    expect(typeof client.wave.retryStep).toBe('function')
    expect(typeof client.wave.skipStep).toBe('function')
    expect(typeof client.wave.forceMarkComplete).toBe('function')
    expect(typeof client.wave.resumeExecution).toBe('function')
    expect(typeof client.wave.interruptedSessions).toBe('function')
  })

  it('has scout namespace with all methods', () => {
    expect(typeof client.scout.run).toBe('function')
    expect(typeof client.scout.subscribeEvents).toBe('function')
    expect(typeof client.scout.cancel).toBe('function')
    expect(typeof client.scout.rerunScaffold).toBe('function')
  })

  it('has config namespace with all methods', () => {
    expect(typeof client.config.get).toBe('function')
    expect(typeof client.config.save).toBe('function')
    expect(typeof client.config.browse).toBe('function')
    expect(typeof client.config.browseNative).toBe('function')
    expect(typeof client.config.context.get).toBe('function')
    expect(typeof client.config.context.put).toBe('function')
  })

  it('has autonomy namespace with all methods', () => {
    expect(typeof client.autonomy.fetchPipeline).toBe('function')
    expect(typeof client.autonomy.fetchQueue).toBe('function')
    expect(typeof client.autonomy.addQueueItem).toBe('function')
    expect(typeof client.autonomy.deleteQueueItem).toBe('function')
    expect(typeof client.autonomy.updateQueuePriority).toBe('function')
    expect(typeof client.autonomy.fetchConfig).toBe('function')
    expect(typeof client.autonomy.saveConfig).toBe('function')
    expect(typeof client.autonomy.startDaemon).toBe('function')
    expect(typeof client.autonomy.stopDaemon).toBe('function')
    expect(typeof client.autonomy.fetchDaemonStatus).toBe('function')
    expect(typeof client.autonomy.subscribeDaemonEvents).toBe('function')
  })

  it('has program namespace with all methods', () => {
    expect(typeof client.program.list).toBe('function')
    expect(typeof client.program.status).toBe('function')
    expect(typeof client.program.tierStatus).toBe('function')
    expect(typeof client.program.executeTier).toBe('function')
    expect(typeof client.program.contracts).toBe('function')
    expect(typeof client.program.replan).toBe('function')
    expect(typeof client.program.runPlanner).toBe('function')
    expect(typeof client.program.subscribePlannerEvents).toBe('function')
    expect(typeof client.program.cancelPlanner).toBe('function')
  })

  it('has files namespace with all methods', () => {
    expect(typeof client.files.tree).toBe('function')
    expect(typeof client.files.read).toBe('function')
    expect(typeof client.files.diff).toBe('function')
    expect(typeof client.files.gitStatus).toBe('function')
  })
})

// ── Fetch URL tests ─────────────────────────────────────────────────────────

describe('SawClient fetch URLs', () => {
  const client = createHttpClient()

  it('impl.list calls GET /api/impl', async () => {
    mockFetch.mockResolvedValueOnce(okJson([]))
    await client.impl.list()
    expect(mockFetch).toHaveBeenCalledWith('/api/impl')
  })

  it('impl.get calls GET /api/impl/:slug', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ slug: 'test' }))
    await client.impl.get('my-feature')
    expect(mockFetch).toHaveBeenCalledWith('/api/impl/my-feature')
  })

  it('impl.approve calls POST /api/impl/:slug/approve', async () => {
    mockFetch.mockResolvedValueOnce(okJson({}))
    await client.impl.approve('my-feature')
    expect(mockFetch).toHaveBeenCalledWith('/api/impl/my-feature/approve', { method: 'POST' })
  })

  it('wave.start calls POST /api/wave/:slug/start', async () => {
    mockFetch.mockResolvedValueOnce(okJson({}))
    await client.wave.start('my-feature')
    expect(mockFetch).toHaveBeenCalledWith('/api/wave/my-feature/start', { method: 'POST' })
  })

  it('wave.mergeWave calls POST /api/wave/:slug/merge with wave number', async () => {
    mockFetch.mockResolvedValueOnce(okJson({}))
    await client.wave.mergeWave('my-feature', 2)
    expect(mockFetch).toHaveBeenCalledWith('/api/wave/my-feature/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wave: 2 }),
    })
  })

  it('scout.run calls POST /api/scout/run with feature', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ run_id: 'abc' }))
    const result = await client.scout.run('my feature')
    expect(mockFetch).toHaveBeenCalledWith('/api/scout/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: expect.stringContaining('"feature":"my feature"'),
    })
    expect(result).toEqual({ runId: 'abc' })
  })

  it('config.get calls GET /api/config and defaults repos', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ some: 'value' }))
    const result = await client.config.get()
    expect(mockFetch).toHaveBeenCalledWith('/api/config')
    expect(result.repos).toEqual([])
  })

  it('autonomy.fetchPipeline calls GET /api/pipeline', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ entries: [] }))
    await client.autonomy.fetchPipeline()
    expect(mockFetch).toHaveBeenCalledWith('/api/pipeline')
  })

  it('program.list calls GET /api/programs and extracts .programs', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ programs: [{ slug: 'p1' }] }))
    const result = await client.program.list()
    expect(mockFetch).toHaveBeenCalledWith('/api/programs')
    expect(result).toEqual([{ slug: 'p1' }])
  })

  it('files.tree calls GET /api/files/tree with repo param', async () => {
    mockFetch.mockResolvedValueOnce(okJson({ repo: 'r', root: {} }))
    await client.files.tree('my-repo')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('/api/files/tree')
    expect(url).toContain('repo=my-repo')
  })
})

// ── Error handling tests ────────────────────────────────────────────────────

describe('SawClient error handling', () => {
  const client = createHttpClient()

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('internal error'),
    })
    await expect(client.impl.list()).rejects.toThrow('HTTP 500: internal error')
  })

  it('wave.resumeExecution returns error object instead of throwing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      text: () => Promise.resolve('conflict'),
    })
    const result = await client.wave.resumeExecution('slug')
    expect(result).toEqual({ success: false, error: 'conflict' })
  })

  it('wave.interruptedSessions returns empty array on failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    const result = await client.wave.interruptedSessions()
    expect(result).toEqual([])
  })

  it('config.browseNative returns null on 204 (cancelled)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204 })
    const result = await client.config.browseNative()
    expect(result).toBeNull()
  })

  it('impl.criticReview returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    const result = await client.impl.criticReview('slug')
    expect(result).toBeNull()
  })
})
