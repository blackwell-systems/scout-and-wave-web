import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useNotifications } from '../useNotifications'

// Mock the EventSource
class MockEventSource {
  url: string
  listeners: Map<string, Function[]> = new Map()
  onerror: ((event: Event) => void) | null = null

  constructor(url: string) {
    this.url = url
  }

  addEventListener(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event)!.push(callback)
  }

  removeEventListener(event: string, callback: Function) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      const index = callbacks.indexOf(callback)
      if (index > -1) {
        callbacks.splice(index, 1)
      }
    }
  }

  dispatchEvent(eventType: string, data: any) {
    const callbacks = this.listeners.get(eventType)
    if (callbacks) {
      const event = new MessageEvent(eventType, { data: JSON.stringify(data) })
      callbacks.forEach((cb) => cb(event))
    }
  }

  close() {
    this.listeners.clear()
  }
}

describe('useNotifications', () => {
  let mockEventSource: MockEventSource
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Mock EventSource
    mockEventSource = new MockEventSource('/api/events')
    global.EventSource = class {
      constructor() {
        return mockEventSource
      }
    } as any

    // Mock fetch for preferences API
    fetchMock = vi.fn()
    global.fetch = fetchMock

    // Mock Notification API
    global.Notification = {
      permission: 'granted',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    } as any

    // Mock crypto.randomUUID
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'test-uuid-' + Math.random()),
    })

    // Set up default fetch responses
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/notifications/preferences') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              enabled: true,
              muted_types: [],
              browser_notify: false,
              toast_notify: true,
            }),
        })
      }
      return Promise.resolve({ ok: true })
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads preferences on mount', async () => {
    const { result } = renderHook(() => useNotifications())

    await waitFor(() => {
      expect(result.current.preferences.enabled).toBe(true)
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/notifications/preferences')
  })

  it('adds toast when notification event received and tab focused', async () => {
    // Make sure document is visible
    Object.defineProperty(document, 'hidden', {
      writable: true,
      value: false,
    })

    const { result } = renderHook(() => useNotifications())

    // Wait for preferences to load
    await waitFor(() => {
      expect(result.current.preferences.enabled).toBe(true)
    })

    // Dispatch a notification event
    act(() => {
      mockEventSource.dispatchEvent('notification', {
        type: 'wave_complete',
        slug: 'test-impl',
        title: 'Wave Complete',
        message: 'Wave 1 has completed successfully',
        severity: 'success',
      })
    })

    await waitFor(() => {
      expect(result.current.toasts.length).toBe(1)
    })

    expect(result.current.toasts[0]).toMatchObject({
      type: 'wave_complete',
      title: 'Wave Complete',
      message: 'Wave 1 has completed successfully',
      severity: 'success',
    })
  })

  it('shows browser notification when tab hidden', async () => {
    // Set document as hidden
    Object.defineProperty(document, 'hidden', {
      writable: true,
      value: true,
    })

    const mockNotificationConstructor = vi.fn()
    global.Notification = mockNotificationConstructor as any
    global.Notification.permission = 'granted'

    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/notifications/preferences') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              enabled: true,
              muted_types: [],
              browser_notify: true,
              toast_notify: true,
            }),
        })
      }
      return Promise.resolve({ ok: true })
    })

    const { result } = renderHook(() => useNotifications())

    // Wait for preferences to load
    await waitFor(() => {
      expect(result.current.preferences.browser_notify).toBe(true)
    })

    // Dispatch a notification event
    act(() => {
      mockEventSource.dispatchEvent('notification', {
        type: 'agent_failed',
        slug: 'test-impl',
        title: 'Agent Failed',
        message: 'Agent A failed to complete',
        severity: 'error',
      })
    })

    await waitFor(() => {
      expect(mockNotificationConstructor).toHaveBeenCalledWith('Agent Failed', {
        body: 'Agent A failed to complete',
        icon: '/favicon.ico',
        tag: 'test-impl',
      })
    })
  })

  it('respects muted_types', async () => {
    Object.defineProperty(document, 'hidden', {
      writable: true,
      value: false,
    })

    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/notifications/preferences') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              enabled: true,
              muted_types: ['wave_complete'],
              browser_notify: false,
              toast_notify: true,
            }),
        })
      }
      return Promise.resolve({ ok: true })
    })

    const { result } = renderHook(() => useNotifications())

    // Wait for preferences to load
    await waitFor(() => {
      expect(result.current.preferences.muted_types).toContain('wave_complete')
    })

    // Dispatch a muted notification event
    act(() => {
      mockEventSource.dispatchEvent('notification', {
        type: 'wave_complete',
        slug: 'test-impl',
        title: 'Wave Complete',
        message: 'Wave 1 has completed successfully',
        severity: 'success',
      })
    })

    // Wait a bit to ensure no toast is added
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(result.current.toasts.length).toBe(0)
  })

  it('dismissToast removes toast by id', async () => {
    Object.defineProperty(document, 'hidden', {
      writable: true,
      value: false,
    })

    const { result } = renderHook(() => useNotifications())

    // Wait for preferences to load
    await waitFor(() => {
      expect(result.current.preferences.enabled).toBe(true)
    })

    // Add two toasts
    act(() => {
      mockEventSource.dispatchEvent('notification', {
        type: 'wave_complete',
        slug: 'test-impl-1',
        title: 'Wave 1 Complete',
        message: 'First wave done',
        severity: 'success',
      })
    })

    act(() => {
      mockEventSource.dispatchEvent('notification', {
        type: 'wave_complete',
        slug: 'test-impl-2',
        title: 'Wave 2 Complete',
        message: 'Second wave done',
        severity: 'success',
      })
    })

    await waitFor(() => {
      expect(result.current.toasts.length).toBe(2)
    })

    const firstToastId = result.current.toasts[0].id

    // Dismiss the first toast
    act(() => {
      result.current.dismissToast(firstToastId)
    })

    await waitFor(() => {
      expect(result.current.toasts.length).toBe(1)
    })

    expect(result.current.toasts[0].title).toBe('Wave 2 Complete')
  })

  it('updatePreferences saves and updates state', async () => {
    const { result } = renderHook(() => useNotifications())

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.preferences.enabled).toBe(true)
    })

    const newPrefs = {
      enabled: false,
      muted_types: ['agent_failed'] as any[],
      browser_notify: true,
      toast_notify: false,
    }

    // Update preferences
    await act(async () => {
      await result.current.updatePreferences(newPrefs)
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/notifications/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newPrefs),
    })

    expect(result.current.preferences).toEqual(newPrefs)
  })

  it('does not show notification when disabled', async () => {
    Object.defineProperty(document, 'hidden', {
      writable: true,
      value: false,
    })

    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/notifications/preferences') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              enabled: false,
              muted_types: [],
              browser_notify: false,
              toast_notify: true,
            }),
        })
      }
      return Promise.resolve({ ok: true })
    })

    const { result } = renderHook(() => useNotifications())

    // Wait for preferences to load
    await waitFor(() => {
      expect(result.current.preferences.enabled).toBe(false)
    })

    // Dispatch a notification event
    act(() => {
      mockEventSource.dispatchEvent('notification', {
        type: 'wave_complete',
        slug: 'test-impl',
        title: 'Wave Complete',
        message: 'Wave 1 has completed successfully',
        severity: 'success',
      })
    })

    // Wait a bit to ensure no toast is added
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(result.current.toasts.length).toBe(0)
  })
})
