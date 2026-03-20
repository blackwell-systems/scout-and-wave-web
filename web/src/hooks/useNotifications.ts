import { useState, useEffect, useCallback, useRef } from 'react'
import { Toast } from '../components/ToastContainer'
import { useGlobalEvents } from './useGlobalEvents'
import { sawClient } from '../lib/apiClient'

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

// API functions for notification preferences — delegate to sawClient
async function getNotificationPrefs(): Promise<NotificationPreferences> {
  return await sawClient.notifications.getPreferences() as NotificationPreferences
}

async function saveNotificationPrefs(prefs: NotificationPreferences): Promise<void> {
  await sawClient.notifications.savePreferences(prefs)
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
  browser_notify: true,
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

  // Refs to capture current reactive values so the stable handler doesn't need
  // re-registration when preferences, isPageVisible, or browserPermission change.
  const preferencesRef = useRef(preferences)
  const isPageVisibleRef = useRef(isPageVisible)
  const browserPermissionRef = useRef(browserPermission)

  useEffect(() => { preferencesRef.current = preferences }, [preferences])
  useEffect(() => { isPageVisibleRef.current = isPageVisible }, [isPageVisible])
  useEffect(() => { browserPermissionRef.current = browserPermission }, [browserPermission])

  // Listen for notification events on the shared SSE singleton.
  // Uses refs to read current preferences/visibility so the handler is stable.
  const handleNotification = useCallback((event: MessageEvent) => {
    try {
      const notificationEvent: NotificationEvent = JSON.parse(event.data)
      const prefs = preferencesRef.current
      const visible = isPageVisibleRef.current
      const permission = browserPermissionRef.current

      // Check if notifications are enabled
      if (!prefs.enabled) {
        return
      }

      // Check if this event type is muted
      if ((prefs.muted_types || []).includes(notificationEvent.type)) {
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
      if (visible && prefs.toast_notify) {
        setToasts((prev) => [...prev, toast])
      }

      // Show browser notification if tab is NOT focused and browser_notify is true
      if (!visible && prefs.browser_notify && permission === 'granted') {
        new Notification(notificationEvent.title, {
          body: notificationEvent.message,
          icon: '/favicon.ico',
          tag: notificationEvent.slug, // Prevents duplicate notifications for the same event
        })
      }
    } catch (err) {
      console.error('Failed to process notification event:', err)
    }
  }, []) // stable — no deps, reads current values via refs

  useGlobalEvents({ notification: handleNotification })

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

    window.addEventListener('test-notification', handleTestNotification as EventListener)

    return () => {
      window.removeEventListener('test-notification', handleTestNotification as EventListener)
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
