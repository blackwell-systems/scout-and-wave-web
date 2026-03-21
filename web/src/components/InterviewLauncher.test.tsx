import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import InterviewLauncher from './InterviewLauncher'

// ─── Mock sawClient ──────────────────────────────────────────────────────────

const mockInterviewStart = vi.fn()
const mockInterviewSubscribeEvents = vi.fn()
const mockInterviewAnswer = vi.fn()

vi.mock('../lib/apiClient', () => ({
  sawClient: {
    interview: {
      start: (...args: unknown[]) => mockInterviewStart(...args),
      subscribeEvents: (...args: unknown[]) => mockInterviewSubscribeEvents(...args),
      answer: (...args: unknown[]) => mockInterviewAnswer(...args),
    },
  },
}))

// ─── Mock EventSource ────────────────────────────────────────────────────────

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('InterviewLauncher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockEventSource.instances = []
    // @ts-expect-error mock global
    globalThis.EventSource = MockEventSource
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Test 1: renders form inputs correctly ────────────────────────────────

  it('renders form inputs correctly', () => {
    render(<InterviewLauncher />)

    // Feature description textarea
    const textarea = screen.getByPlaceholderText(/e\.g\. 'A feature that lets users export/)
    expect(textarea).toBeDefined()

    // Max questions input
    const maxQInput = screen.getByLabelText('Max questions')
    expect(maxQInput).toBeDefined()
    expect((maxQInput as HTMLInputElement).value).toBe('12')

    // Start interview button
    const startBtn = screen.getByText('Start Interview')
    expect(startBtn).toBeDefined()

    // Project path toggle
    const toggleBtn = screen.getByText('+ Project path (optional)')
    expect(toggleBtn).toBeDefined()
  })

  // ── Test 2: start button calls sawClient.interview.start with form values ─

  it('calls sawClient.interview.start with correct form values on submit', async () => {
    mockInterviewStart.mockResolvedValue({ runId: 'run-abc' })
    mockInterviewSubscribeEvents.mockImplementation((runId: string) => {
      return new MockEventSource(`/api/interview/${runId}/events`) as unknown as EventSource
    })

    render(<InterviewLauncher />)

    // Fill in description
    const textarea = screen.getByPlaceholderText(/e\.g\. 'A feature that lets users export/)
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )!.set!.call(textarea, 'Build a CSV export feature with filtering')
      textarea.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Click start
    const startBtn = screen.getByText('Start Interview')
    await act(async () => {
      startBtn.click()
    })

    expect(mockInterviewStart).toHaveBeenCalledWith(
      'Build a CSV export feature with filtering',
      { maxQuestions: 12, projectPath: undefined }
    )
    expect(mockInterviewSubscribeEvents).toHaveBeenCalledWith('run-abc')
  })

  // ── Test 3: SSE question event updates component state ───────────────────

  it('displays question text when question SSE event is received', async () => {
    mockInterviewStart.mockResolvedValue({ runId: 'run-xyz' })
    mockInterviewSubscribeEvents.mockImplementation((runId: string) => {
      return new MockEventSource(`/api/interview/${runId}/events`) as unknown as EventSource
    })

    render(<InterviewLauncher />)

    // Fill in description and start
    const textarea = screen.getByPlaceholderText(/e\.g\. 'A feature that lets users export/)
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )!.set!.call(textarea, 'Build a data export feature')
      textarea.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const startBtn = screen.getByText('Start Interview')
    await act(async () => {
      startBtn.click()
    })

    // Wait for SSE subscription
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1))

    const es = MockEventSource.instances[0]

    // Dispatch a question event
    await act(async () => {
      es.dispatchEvent('question', {
        phase: 'Goals',
        question_num: 1,
        max_questions: 12,
        text: 'What is the primary goal of this feature?',
        hint: 'Think about what problem it solves.',
      })
    })

    // Question text should appear
    await waitFor(() => {
      expect(screen.getByText('What is the primary goal of this feature?')).toBeDefined()
    })

    // Hint text should appear
    expect(screen.getByText('Think about what problem it solves.')).toBeDefined()

    // Phase progress should show
    expect(screen.getByText(/Phase 1\/6: Goals/)).toBeDefined()

    // Question counter
    expect(screen.getByText('Q 1/12')).toBeDefined()
  })

  // ── Test 4: answer submit calls sawClient.interview.answer ───────────────

  it('calls sawClient.interview.answer when answer is submitted', async () => {
    mockInterviewStart.mockResolvedValue({ runId: 'run-789' })
    mockInterviewSubscribeEvents.mockImplementation((runId: string) => {
      return new MockEventSource(`/api/interview/${runId}/events`) as unknown as EventSource
    })
    mockInterviewAnswer.mockResolvedValue(undefined)

    render(<InterviewLauncher />)

    // Fill in description and start
    const textarea = screen.getByPlaceholderText(/e\.g\. 'A feature that lets users export/)
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )!.set!.call(textarea, 'Build a reporting dashboard')
      textarea.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const startBtn = screen.getByText('Start Interview')
    await act(async () => {
      startBtn.click()
    })

    await waitFor(() => expect(MockEventSource.instances.length).toBe(1))

    const es = MockEventSource.instances[0]

    // Dispatch question event to enable answer input
    await act(async () => {
      es.dispatchEvent('question', {
        phase: 'Goals',
        question_num: 1,
        max_questions: 10,
        text: 'What dashboards do you need?',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('What dashboards do you need?')).toBeDefined()
    })

    // Fill in answer textarea
    const answerTextarea = screen.getByPlaceholderText('Type your answer...')
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )!.set!.call(answerTextarea, 'Sales and revenue dashboards with real-time data')
      answerTextarea.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Click Submit Answer
    const submitBtn = screen.getByText('Submit Answer')
    await act(async () => {
      submitBtn.click()
    })

    await waitFor(() => {
      expect(mockInterviewAnswer).toHaveBeenCalledWith(
        'run-789',
        'Sales and revenue dashboards with real-time data'
      )
    })
  })
})
