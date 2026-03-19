import { NotificationPreferences, NotificationEventType } from '../hooks/useNotifications'

interface NotificationSettingsProps {
  preferences: NotificationPreferences
  onUpdate: (prefs: NotificationPreferences) => Promise<void>
  browserPermission?: NotificationPermission
  onRequestPermission?: () => Promise<NotificationPermission>
}

const EVENT_TYPE_LABELS: Record<NotificationEventType, string> = {
  wave_complete: 'Wave Complete',
  agent_failed: 'Agent Failed',
  merge_complete: 'Merge Complete',
  merge_failed: 'Merge Failed',
  scaffold_complete: 'Scaffold Complete',
  build_verify_pass: 'Build Verification Passed',
  build_verify_fail: 'Build Verification Failed',
  impl_complete: 'IMPL Complete',
  run_failed: 'Run Failed',
}

const ALL_EVENT_TYPES: NotificationEventType[] = [
  'wave_complete',
  'agent_failed',
  'merge_complete',
  'merge_failed',
  'scaffold_complete',
  'build_verify_pass',
  'build_verify_fail',
  'impl_complete',
  'run_failed',
]

export default function NotificationSettings({
  preferences,
  onUpdate,
  browserPermission = 'default',
  onRequestPermission,
}: NotificationSettingsProps): JSX.Element {
  const handleToggleEnabled = async () => {
    await onUpdate({
      ...preferences,
      enabled: !preferences.enabled,
    })
  }

  const handleToggleBrowserNotify = async () => {
    // If enabling browser notifications and permission not granted, request it
    if (!preferences.browser_notify && browserPermission !== 'granted' && onRequestPermission) {
      const permission = await onRequestPermission()
      if (permission !== 'granted') {
        return // Don't enable if permission denied
      }
    }
    await onUpdate({
      ...preferences,
      browser_notify: !preferences.browser_notify,
    })
  }

  const handleToggleToastNotify = async () => {
    await onUpdate({
      ...preferences,
      toast_notify: !preferences.toast_notify,
    })
  }

  const handleToggleEventType = async (eventType: NotificationEventType) => {
    const isMuted = preferences.muted_types.includes(eventType)
    const newMutedTypes = isMuted
      ? preferences.muted_types.filter((t) => t !== eventType)
      : [...preferences.muted_types, eventType]

    await onUpdate({
      ...preferences,
      muted_types: newMutedTypes,
    })
  }

  const handleTestNotification = () => {
    // Dispatch a test toast by creating a custom event
    // This will be picked up by the notification handler
    const testEvent = new CustomEvent('test-notification', {
      detail: {
        type: 'info',
        title: 'Test Notification',
        message: 'This is a test notification to verify your settings.',
        severity: 'info',
      },
    })
    window.dispatchEvent(testEvent)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
          Notification Settings
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Configure how you want to be notified about pipeline events.
        </p>
      </div>

      {/* Master Enable/Disable */}
      <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div>
          <label htmlFor="enabled" className="font-medium text-gray-900 dark:text-gray-100">
            Enable Notifications
          </label>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Master switch for all notifications
          </p>
        </div>
        <input
          type="checkbox"
          id="enabled"
          checked={preferences.enabled}
          onChange={handleToggleEnabled}
          className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Toast Notifications */}
      <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
        <div>
          <label htmlFor="toast-notify" className="font-medium text-gray-900 dark:text-gray-100">
            Toast Notifications
          </label>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Show notifications in the bottom-right corner when the page is visible
          </p>
        </div>
        <input
          type="checkbox"
          id="toast-notify"
          checked={preferences.toast_notify}
          onChange={handleToggleToastNotify}
          disabled={!preferences.enabled}
          className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
      </div>

      {/* Browser Notifications */}
      <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
        <div className="flex-1">
          <label htmlFor="browser-notify" className="font-medium text-gray-900 dark:text-gray-100">
            Browser Notifications
          </label>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Show native browser notifications when the page is not visible
          </p>
          {browserPermission === 'denied' && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">
              Browser notifications are blocked. Please enable them in your browser settings.
            </p>
          )}
          {browserPermission === 'default' && !preferences.browser_notify && (
            <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
              Permission will be requested when you enable this setting.
            </p>
          )}
        </div>
        <input
          type="checkbox"
          id="browser-notify"
          checked={preferences.browser_notify}
          onChange={handleToggleBrowserNotify}
          disabled={!preferences.enabled || browserPermission === 'denied'}
          className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
      </div>

      {/* Event Type Filters */}
      <div className="space-y-3">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Event Types</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          Select which events should trigger notifications
        </p>
        <div className="space-y-2">
          {ALL_EVENT_TYPES.map((eventType) => {
            const isEnabled = !preferences.muted_types.includes(eventType)
            return (
              <div
                key={eventType}
                className="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-700 rounded"
              >
                <label
                  htmlFor={`event-${eventType}`}
                  className="text-sm text-gray-900 dark:text-gray-100"
                >
                  {EVENT_TYPE_LABELS[eventType]}
                </label>
                <input
                  type="checkbox"
                  id={`event-${eventType}`}
                  checked={isEnabled}
                  onChange={() => handleToggleEventType(eventType)}
                  disabled={!preferences.enabled}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Test Notification Button */}
      <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={handleTestNotification}
          disabled={!preferences.enabled}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Test Notification
        </button>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
          Sends a test toast notification to verify your settings
        </p>
      </div>
    </div>
  )
}
