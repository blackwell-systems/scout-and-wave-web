import { useState } from 'react'
import { Button } from './ui/button'
import { useWebhooks, WebhookAdapter } from '../hooks/useWebhooks'

const ADAPTER_TYPE_LABELS: Record<WebhookAdapter['type'], string> = {
  slack: 'Slack',
  discord: 'Discord',
  telegram: 'Telegram',
}

const ADAPTER_TYPE_COLORS: Record<WebhookAdapter['type'], string> = {
  slack: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  discord: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  telegram: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
}

interface AdapterFieldDef {
  key: keyof WebhookAdapter
  label: string
  placeholder: string
}

const ADAPTER_FIELDS: Record<WebhookAdapter['type'], AdapterFieldDef[]> = {
  slack: [
    { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...' },
    { key: 'channel', label: 'Channel (optional)', placeholder: '#general' },
  ],
  discord: [
    { key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/...' },
  ],
  telegram: [
    { key: 'bot_token', label: 'Bot Token', placeholder: '123456:ABC-DEF...' },
    { key: 'chat_id', label: 'Chat ID', placeholder: '-1001234567890' },
  ],
}

interface TestResult {
  index: number
  success: boolean
  error?: string
}

export default function WebhookSettings(): JSX.Element {
  const {
    config,
    loading,
    saving,
    error,
    updateConfig,
    testAdapter,
    addAdapter,
    removeAdapter,
  } = useWebhooks()

  const [testResults, setTestResults] = useState<Record<number, TestResult>>({})
  const [testingIndex, setTestingIndex] = useState<number | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)

  const handleToggleEnabled = async () => {
    await updateConfig({ ...config, enabled: !config.enabled })
  }

  const handleFieldChange = (index: number, field: keyof WebhookAdapter, value: string) => {
    const updated = config.adapters.map((adapter, i) =>
      i === index ? { ...adapter, [field]: value } : adapter
    )
    // Local state update only; save on blur or explicit save
    updateConfig({ ...config, adapters: updated })
  }

  const handleTest = async (index: number) => {
    setTestingIndex(index)
    setTestResults((prev) => {
      const next = { ...prev }
      delete next[index]
      return next
    })
    try {
      const result = await testAdapter(index)
      setTestResults((prev) => ({ ...prev, [index]: { index, ...result } }))
    } finally {
      setTestingIndex(null)
    }
  }

  const handleRemove = (index: number) => {
    removeAdapter(index)
    setTestResults((prev) => {
      const next: Record<number, TestResult> = {}
      for (const [k, v] of Object.entries(prev)) {
        const ki = Number(k)
        if (ki < index) next[ki] = v
        else if (ki > index) next[ki - 1] = { ...v, index: ki - 1 }
      }
      return next
    })
  }

  const handleAddAdapter = (type: WebhookAdapter['type']) => {
    addAdapter(type)
    setShowAddMenu(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
        Loading webhook settings...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
          Webhook Notifications
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Send pipeline event notifications to external services like Slack, Discord, or Telegram.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Master Enable/Disable */}
      <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div>
          <label htmlFor="webhook-enabled" className="font-medium text-gray-900 dark:text-gray-100">
            Enable Webhooks
          </label>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Master switch for all webhook notifications
          </p>
        </div>
        <input
          type="checkbox"
          id="webhook-enabled"
          checked={config.enabled}
          onChange={handleToggleEnabled}
          disabled={saving}
          className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Adapter List */}
      {config.adapters.map((adapter, index) => {
        const fields = ADAPTER_FIELDS[adapter.type]
        const result = testResults[index]
        const isTesting = testingIndex === index

        return (
          <div
            key={index}
            className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg space-y-3"
          >
            {/* Header: type badge + remove */}
            <div className="flex items-center justify-between">
              <span
                className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${ADAPTER_TYPE_COLORS[adapter.type]}`}
              >
                {ADAPTER_TYPE_LABELS[adapter.type]}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="text-sm text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors"
                title="Remove adapter"
              >
                Remove
              </button>
            </div>

            {/* Config fields */}
            {fields.map((field) => (
              <div key={field.key} className="flex flex-col gap-1">
                <label
                  htmlFor={`adapter-${index}-${field.key}`}
                  className="text-sm text-gray-700 dark:text-gray-300"
                >
                  {field.label}
                </label>
                <input
                  id={`adapter-${index}-${field.key}`}
                  type="text"
                  value={(adapter[field.key] as string) ?? ''}
                  onChange={(e) => handleFieldChange(index, field.key, e.target.value)}
                  placeholder={field.placeholder}
                  disabled={!config.enabled || saving}
                  className="text-sm px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 placeholder:text-gray-400 dark:placeholder:text-gray-600"
                />
              </div>
            ))}

            {/* Test button + result */}
            <div className="flex items-center gap-3 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleTest(index)}
                disabled={!config.enabled || saving || isTesting}
              >
                {isTesting ? 'Testing...' : 'Test'}
              </Button>
              {result && (
                <span
                  className={`text-sm ${
                    result.success
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {result.success ? 'Delivered successfully' : result.error ?? 'Test failed'}
                </span>
              )}
            </div>
          </div>
        )
      })}

      {/* Add Adapter */}
      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAddMenu(!showAddMenu)}
          disabled={!config.enabled || saving}
        >
          + Add Adapter
        </Button>
        {showAddMenu && (
          <div className="absolute mt-1 z-10 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1">
            {(['slack', 'discord', 'telegram'] as const).map((type) => (
              <button
                key={type}
                onClick={() => handleAddAdapter(type)}
                className="w-full text-left px-3 py-2 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium mr-2 ${ADAPTER_TYPE_COLORS[type]}`}>
                  {ADAPTER_TYPE_LABELS[type]}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {config.adapters.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">
          No webhook adapters configured. Add one above to start receiving external notifications.
        </p>
      )}
    </div>
  )
}
