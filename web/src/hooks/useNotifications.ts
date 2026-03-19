import { useState, useEffect, useCallback } from 'react'
import { Toast } from '../components/ToastContainer'

// Mirror the Go types from pkg/api/notification_types.go
export type NotificationEventType =
  | 'wave_complete'
  | 'agent_failed'
  | 'merge_complete'
  | 'merge_failed'
  | 'scaffold_complete'
  | 'build_verify_pass'
  | 'build_verify_fail'
  | 'impl_complete'
  | 'run_failed'

export interface NotificationEvent {
  type: NotificationEventType
  slug: string
  title: string
  message: string
  severity: 'info' | 'success' | 'warning' | 'error'
}

export interface NotificationPreferences {
  enabled: boolean
  muted_types: NotificationEventType[]
  browser_notify: boolean
  toast_notify: boolean
}

// API functions for notification preferences
async function getNotificationPrefs(): Promise<NotificationPreferences> {
  const response = await fetch('/api/notifications/preferences')
  if (!response.ok) {
    throw new Error(`Failed to fetch notification preferences: ${response.statusText}`)
  }
  return response.json()
}

async function saveNotificationPrefs(prefs: NotificationPreferences): Promise<void> {
  const response = await fetch('/api/notifications/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  })
  if (!response.ok) {
    throw new Error(`Failed to save notification preferences: ${response.statusText}`)
  }
}

// Request browser notification permission
async function requestBrowserNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    return 'denied'
  }
  if (Notification.permission === 'granted') {
    return 'granted'
  }
  if (Notification.permission === 'denied') {
    return 'denied'
  }
  return await Notification.requestPermission()
}

interface UseNotificationsReturn {
  toasts: Toast[]
  dismissToast: (id: string) => void
  preferences: NotificationPreferences
  updatePreferences: (prefs: NotificationPreferences) => Promise<void>
  browserPermission: NotificationPermission
  requestPermission: () => Promise<NotificationPermission>
}

const defaultPreferences: NotificationPreferences = {
  enabled: true,
  muted_types: [],
  browser_notify: false,
  toast_notify: true,
}

export function useNotifications(): UseNotificationsReturn {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultPreferences)
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied'
  )

  // Load preferences on mount
  useEffect(() => {
    getNotificationPrefs()
      .then(setPreferences)
      .catch((err) => {
        console.error('Failed to load notification preferences:', err)
      })
  }, [])

  // Track document visibility state
  const [isPageVisible, setIsPageVisible] = useState(!document.hidden)

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsPageVisible(!document.hidden)
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  // Listen for notification events on SSE stream
  useEffect(() => {
    const eventSource = new EventSource('/api/events')

    const handleNotification = (event: MessageEvent) => {
      try {
        const notificationEvent: NotificationEvent = JSON.parse(event.data)

        // Check if notifications are enabled
        if (!preferences.enabled) {
          return
        }

        // Check if this event type is muted
        if (preferences.muted_types.includes(notificationEvent.type)) {
          return
        }

        // Prepare toast object
        const toast: Toast = {
          id: crypto.randomUUID(),
          type: notificationEvent.type,
          title: notificationEvent.title,
          message: notificationEvent.message,
          severity: notificationEvent.severity,
          timestamp: Date.now(),
        }

        // Show toast if tab is focused and toast_notify is true
        if (isPageVisible && preferences.toast_notify) {
          setToasts((prev) => [...prev, toast])
        }

        // Show browser notification if tab is NOT focused and browser_notify is true
        if (!isPageVisible && preferences.browser_notify && browserPermission === 'granted') {
          new Notification(notificationEvent.title, {
            body: notificationEvent.message,
            icon: '/favicon.ico',
            tag: notificationEvent.slug, // Prevents duplicate notifications for the same event
          })
        }

        // If both are true: show both
        if (isPageVisible && !isPageVisible) {
          // This condition never happens, but the spec mentions showing both
          // In reality: page is either visible OR hidden, so we show the appropriate notification type
        }
      } catch (err) {
        console.error('Failed to process notification event:', err)
      }
    }

    eventSource.addEventListener('notification', handleNotification)

    eventSource.onerror = (err) => {
      console.error('SSE connection error:', err)
    }

    return () => {
      eventSource.removeEventListener('notification', handleNotification)
      eventSource.close()
    }
  }, [preferences, isPageVisible, browserPermission])

  // Listen for test notification events
  useEffect(() => {
    const handleTestNotification = () => {
      const toast: Toast = {
        id: crypto.randomUUID(),
        type: 'info',
        title: 'Test Notification',
        message: 'This is a test notification to verify your settings.',
        severity: 'info',
        timestamp: Date.now(),
      }
      setToasts((prev) => [...prev, toast])
    }

    window.addEventListener('test-notification', handleTestNotification)

    return () => {
      window.removeEventListener('test-notification', handleTestNotification)
    }
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const updatePreferences = useCallback(async (prefs: NotificationPreferences) => {
    await saveNotificationPrefs(prefs)
    setPreferences(prefs)
  }, [])

  const requestPermission = useCallback(async () => {
    const permission = await requestBrowserNotificationPermission()
    setBrowserPermission(permission)
    return permission
  }, [])

  return {
    toasts,
    dismissToast,
    preferences,
    updatePreferences,
    browserPermission,
    requestPermission,
  }
}
