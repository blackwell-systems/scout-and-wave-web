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
    expect(screen.getByText('Plan Review')).toBeInTheDocument()
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
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toBe('/api/wave/my-slug/events')
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

    const es = MockEventSource.instances[0]
    await act(async () => {
      es.dispatchEvent('wave_complete', { wave: 1, merge_status: 'ok' })
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

    const es = MockEventSource.instances[0]
    expect(es.closeCalled).toBe(false)

    unmount()

    expect(es.closeCalled).toBe(true)
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

    const es = MockEventSource.instances[0]

    // Should not throw even though onRefreshImpl is undefined
    await expect(
      act(async () => {
        es.dispatchEvent('wave_complete', { wave: 1, merge_status: 'ok' })
      })
    ).resolves.not.toThrow()
  })
})
