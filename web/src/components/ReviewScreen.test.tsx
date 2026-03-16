import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import ReviewScreen from './ReviewScreen'
import { IMPLDocResponse } from '../types'

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
})

afterEach(() => {
  vi.unstubAllGlobals()
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

  it('subscribes to SSE on mount', () => {
    render(
      <ReviewScreen
        slug="my-slug"
        impl={makeImpl()}
        onApprove={() => {}}
        onReject={() => {}}
      />
    )
    // ReviewScreen creates two SSE connections: one via useExecutionSync (useWaveEvents)
    // and one in its own useEffect for wave_complete → onRefreshImpl wiring.
    expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1)
    expect(MockEventSource.instances.every(es => es.url === '/api/wave/my-slug/events')).toBe(true)
  })

  it('calls onRefreshImpl on wave_complete event', async () => {
    const onRefreshImpl = vi.fn().mockResolvedValue(undefined)

    render(
      <ReviewScreen
        slug="my-slug"
        impl={makeImpl()}
        onApprove={() => {}}
        onReject={() => {}}
        onRefreshImpl={onRefreshImpl}
      />
    )

    // Dispatch wave_complete on all SSE instances — the ReviewScreen useEffect
    // listener will pick it up and call onRefreshImpl.
    await act(async () => {
      for (const es of MockEventSource.instances) {
        es.dispatchEvent('wave_complete', { wave: 1, merge_status: 'ok' })
      }
    })

    expect(onRefreshImpl).toHaveBeenCalledTimes(1)
    expect(onRefreshImpl).toHaveBeenCalledWith('my-slug')
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
    render(
      <ReviewScreen
        slug="my-slug"
        impl={makeImpl()}
        onApprove={() => {}}
        onReject={() => {}}
      />
    )

    // Should not throw even though onRefreshImpl is undefined
    await expect(
      act(async () => {
        for (const es of MockEventSource.instances) {
          es.dispatchEvent('wave_complete', { wave: 1, merge_status: 'ok' })
        }
      })
    ).resolves.not.toThrow()
  })
})
