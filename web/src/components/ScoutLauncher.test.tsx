import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import ScoutLauncher from './ScoutLauncher'

// Mock the api module
vi.mock('../api', () => ({
  runScout: vi.fn(),
  subscribeScoutEvents: vi.fn(),
  cancelScout: vi.fn(),
}))

// Mock sawClient
const mockImplGet = vi.fn()
vi.mock('../lib/apiClient', () => ({
  sawClient: {
    impl: {
      get: (...args: unknown[]) => mockImplGet(...args),
    },
  },
}))

// Mock react-markdown to avoid ESM issues in tests
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <pre>{children}</pre>,
}))

// Minimal mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  readyState = 0
  listeners: Record<string, Array<(e: MessageEvent) => void>> = {}
  onerror: ((e: Event) => void) | null = null
  closeCalled = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (e: MessageEvent) => void) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(listener)
  }

  dispatchEvent(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) })
    for (const listener of this.listeners[type] ?? []) {
      listener(event)
    }
  }

  close() {
    this.closeCalled = true
  }

  static CLOSED = 2
}

describe('ScoutLauncher completion banner', () => {
  const onComplete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    MockEventSource.instances = []
    // @ts-expect-error mock global
    globalThis.EventSource = MockEventSource
    // @ts-expect-error mock Notification
    globalThis.Notification = { permission: 'default' }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function triggerScoutComplete(implData: Record<string, unknown>) {
    const { runScout, subscribeScoutEvents } = await import('../api')
    const mockedRunScout = vi.mocked(runScout)
    const mockedSubscribe = vi.mocked(subscribeScoutEvents)

    mockedRunScout.mockResolvedValue({ runId: 'run-1' })
    mockedSubscribe.mockImplementation((runId: string) => {
      return new MockEventSource(`/api/scout/${runId}/events`) as unknown as EventSource
    })
    mockImplGet.mockResolvedValue(implData)

    const { container } = render(<ScoutLauncher onComplete={onComplete} />)

    // Type feature text
    const textarea = container.querySelector('textarea')!
    await act(async () => {
      textarea.focus()
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
      )!.set!.call(textarea, 'Add a dark mode toggle to settings screen')
      textarea.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Click run
    const runBtn = screen.getByText('Run Scout')
    await act(async () => { runBtn.click() })

    // Fire scout_complete from the EventSource
    const es = MockEventSource.instances[0]
    await act(async () => {
      es.dispatchEvent('scout_complete', { slug: 'test-feature' })
    })

    // Wait for sawClient.impl.get to resolve
    await waitFor(() => {
      expect(mockImplGet).toHaveBeenCalledWith('test-feature')
    })

    return container
  }

  it('shows "Scout Analysis Complete" header with checkmark', async () => {
    await triggerScoutComplete({
      waves: [{ agents: [{ id: 'A' }, { id: 'B' }] }],
      file_ownership: [{ file: 'a.ts' }, { file: 'b.ts' }],
      interface_contracts_text: 'contract1\ncontract2\n',
      suitability: { verdict: 'SUITABLE' },
    })

    await waitFor(() => {
      expect(screen.getByText(/Scout Analysis Complete/)).toBeDefined()
    })
  })

  it('displays agent count, wave count, file count, and contract count', async () => {
    await triggerScoutComplete({
      waves: [
        { agents: [{ id: 'A' }, { id: 'B' }] },
        { agents: [{ id: 'C' }] },
      ],
      file_ownership: [{ file: 'a.ts' }, { file: 'b.ts' }, { file: 'c.ts' }],
      interface_contracts_text: 'line1\nline2\nline3\n',
      suitability: { verdict: 'SUITABLE' },
    })

    await waitFor(() => {
      expect(screen.getByText(/3 agents across 2 waves/)).toBeDefined()
      expect(screen.getByText(/3 files involved/)).toBeDefined()
      expect(screen.getByText(/3 interface contracts defined/)).toBeDefined()
    })
  })

  it('shows the "Next:" guidance subtext', async () => {
    await triggerScoutComplete({
      waves: [{ agents: [{ id: 'A' }] }],
      file_ownership: [{ file: 'a.ts' }],
      interface_contracts_text: 'contract1\n',
      suitability: { verdict: '' },
    })

    await waitFor(() => {
      expect(screen.getByText(/Next: Review wave structure and approve to launch agents/)).toBeDefined()
    })
  })

  it('keeps the Review button and calls onComplete when clicked', async () => {
    await triggerScoutComplete({
      waves: [{ agents: [{ id: 'A' }] }],
      file_ownership: [],
      interface_contracts_text: '',
      suitability: { verdict: '' },
    })

    await waitFor(() => {
      expect(screen.getByText('Review →')).toBeDefined()
    })

    await act(async () => {
      screen.getByText('Review →').click()
    })

    expect(onComplete).toHaveBeenCalledWith('test-feature')
  })

  it('handles zero files and contracts gracefully', async () => {
    await triggerScoutComplete({
      waves: [{ agents: [{ id: 'A' }] }],
      file_ownership: [],
      interface_contracts_text: '',
      suitability: { verdict: '' },
    })

    await waitFor(() => {
      expect(screen.getByText(/Generated 1 agent across 1 wave/)).toBeDefined()
      expect(screen.getByText(/Ready for review/)).toBeDefined()
    })
  })

  it('uses singular form for 1 agent and 1 wave', async () => {
    await triggerScoutComplete({
      waves: [{ agents: [{ id: 'A' }] }],
      file_ownership: [{ file: 'a.ts' }],
      interface_contracts_text: 'one\n',
      suitability: { verdict: '' },
    })

    await waitFor(() => {
      expect(screen.getByText(/1 agent across 1 wave/)).toBeDefined()
      expect(screen.getByText(/1 file involved/)).toBeDefined()
      expect(screen.getByText(/1 interface contract defined/)).toBeDefined()
    })
  })
})
