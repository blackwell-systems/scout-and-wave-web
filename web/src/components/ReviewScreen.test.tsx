import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import ReviewScreen from './ReviewScreen'
import { IMPLDocResponse } from '../types'
import * as api from '../api'

// Minimal IMPLDocResponse fixture
const makeImpl = (): IMPLDocResponse => ({
  slug: 'test-slug',
  doc_status: 'ACTIVE',
  suitability: { verdict: 'SUITABLE', rationale: 'Good plan' },
  file_ownership: [],
  file_ownership_col4_name: 'Action',
  waves: [],
  scaffold: { required: false, files: [], contracts: [] },
  known_issues: [],
  scaffolds_detail: [],
  interface_contracts_text: '',
  dependency_graph_text: '',
  post_merge_checklist_text: '',
  stub_report_text: '',
  agent_prompts: [],
})

// Mock the API module so fetchDiskWaveStatus is controllable in tests
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    fetchDiskWaveStatus: vi.fn(),
    listWorktrees: vi.fn().mockResolvedValue({ worktrees: [] }),
    batchDeleteWorktrees: vi.fn().mockResolvedValue({}),
  }
})

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  listeners: Record<string, Array<(e: Event) => void>> = {}
  closeCalled = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (e: Event) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = []
    }
    this.listeners[type].push(listener)
  }

  dispatchEvent(type: string, data?: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data ?? {}) })
    for (const listener of this.listeners[type] ?? []) {
      listener(event)
    }
  }

  close() {
    this.closeCalled = true
  }
}

beforeEach(() => {
  MockEventSource.instances = []
  vi.stubGlobal('EventSource', MockEventSource)
  // Suppress IntersectionObserver not implemented error in jsdom
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
  })
  // Default: disk status returns empty (no waves merged)
  vi.mocked(api.fetchDiskWaveStatus).mockResolvedValue({
    slug: 'my-slug',
    current_wave: 1,
    total_waves: 1,
    scaffold_status: 'idle',
    agents: [],
    waves_merged: [],
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ReviewScreen', () => {
  it('renders without crashing', () => {
    render(
      <ReviewScreen
        slug="test-slug"
        impl={makeImpl()}
        onApprove={() => {}}
        onReject={() => {}}
      />
    )
    expect(screen.getByText(/Plan Review/)).toBeInTheDocument()
  })

  it('subscribes to SSE on mount via useExecutionSync', () => {
    render(
      <ReviewScreen
        slug="my-slug"
        impl={makeImpl()}
        onApprove={() => {}}
        onReject={() => {}}
      />
    )
    // ReviewScreen no longer creates its own EventSource.
    // useExecutionSync (via useWaveEvents) creates one for /api/wave/:slug/events.
    expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1)
    expect(MockEventSource.instances.every(es => es.url === '/api/wave/my-slug/events')).toBe(true)
  })

  it('calls onRefreshImpl when waves_merged count increases in disk status', async () => {
    const onRefreshImpl = vi.fn().mockResolvedValue(undefined)

    // First render: no waves merged
    vi.mocked(api.fetchDiskWaveStatus).mockResolvedValue({
      slug: 'my-slug',
      current_wave: 1,
      total_waves: 1,
      scaffold_status: 'idle',
      agents: [],
      waves_merged: [],
    })

    const { rerender } = render(
      <ReviewScreen
        slug="my-slug"
        impl={makeImpl()}
        onApprove={() => {}}
        onReject={() => {}}
        onRefreshImpl={onRefreshImpl}
      />
    )

    // Wait for initial disk status to settle
    await act(async () => {
      await Promise.resolve()
    })

    expect(onRefreshImpl).not.toHaveBeenCalled()

    // Simulate a wave merging by updating disk status
    vi.mocked(api.fetchDiskWaveStatus).mockResolvedValue({
      slug: 'my-slug',
      current_wave: 1,
      total_waves: 1,
      scaffold_status: 'idle',
      agents: [],
      waves_merged: [1],
    })

    // Trigger a re-render with refreshTick to cause fetchDiskWaveStatus to be called again
    // (ReviewScreen re-fetches disk status when slug changes; we simulate via rerender)
    await act(async () => {
      rerender(
        <ReviewScreen
          slug="my-slug"
          impl={makeImpl()}
          onApprove={() => {}}
          onReject={() => {}}
          onRefreshImpl={onRefreshImpl}
          refreshTick={1}
        />
      )
      // Allow the fetch to settle
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(onRefreshImpl).toHaveBeenCalledTimes(1)
      expect(onRefreshImpl).toHaveBeenCalledWith('my-slug')
    })
  })

  it('closes EventSource on unmount', () => {
    const { unmount } = render(
      <ReviewScreen
        slug="my-slug"
        impl={makeImpl()}
        onApprove={() => {}}
        onReject={() => {}}
      />
    )

    expect(MockEventSource.instances.every(es => !es.closeCalled)).toBe(true)

    unmount()

    expect(MockEventSource.instances.every(es => es.closeCalled)).toBe(true)
  })

  it('does not crash when onRefreshImpl is not provided', async () => {
    // Simulate waves_merged going from 0 to 1 — should not throw even without onRefreshImpl
    vi.mocked(api.fetchDiskWaveStatus).mockResolvedValue({
      slug: 'my-slug',
      current_wave: 1,
      total_waves: 1,
      scaffold_status: 'idle',
      agents: [],
      waves_merged: [],
    })

    const { rerender } = render(
      <ReviewScreen
        slug="my-slug"
        impl={makeImpl()}
        onApprove={() => {}}
        onReject={() => {}}
      />
    )

    await act(async () => { await Promise.resolve() })

    vi.mocked(api.fetchDiskWaveStatus).mockResolvedValue({
      slug: 'my-slug',
      current_wave: 1,
      total_waves: 1,
      scaffold_status: 'idle',
      agents: [],
      waves_merged: [1],
    })

    await expect(
      act(async () => {
        rerender(
          <ReviewScreen
            slug="my-slug"
            impl={makeImpl()}
            onApprove={() => {}}
            onReject={() => {}}
            refreshTick={1}
          />
        )
        await Promise.resolve()
        await Promise.resolve()
      })
    ).resolves.not.toThrow()
  })
})
