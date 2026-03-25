import { useState, useEffect, useCallback } from 'react'

export interface WebhookAdapter {
  type: 'slack' | 'discord' | 'telegram'
  webhook_url?: string
  channel?: string
  bot_token?: string
  chat_id?: string
}

export interface WebhookConfig {
  enabled: boolean
  adapters: WebhookAdapter[]
}

export interface UseWebhooksReturn {
  config: WebhookConfig
  loading: boolean
  saving: boolean
  error: string | null
  updateConfig: (config: WebhookConfig) => Promise<void>
  testAdapter: (index: number) => Promise<{ success: boolean; error?: string }>
  addAdapter: (type: WebhookAdapter['type']) => void
  removeAdapter: (index: number) => void
}

const defaultConfig: WebhookConfig = {
  enabled: false,
  adapters: [],
}

async function fetchWebhookConfig(): Promise<WebhookConfig> {
  const resp = await fetch('/api/webhooks')
  if (!resp.ok) {
    throw new Error(`Failed to load webhook config: HTTP ${resp.status}`)
  }
  return resp.json() as Promise<WebhookConfig>
}

async function saveWebhookConfig(config: WebhookConfig): Promise<void> {
  const resp = await fetch('/api/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(text || `Failed to save webhook config: HTTP ${resp.status}`)
  }
}

async function testWebhookAdapter(adapterIndex: number): Promise<{ success: boolean; error?: string }> {
  const resp = await fetch('/api/webhooks/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adapter_index: adapterIndex }),
  })
  if (!resp.ok) {
    const text = await resp.text()
    return { success: false, error: text || `HTTP ${resp.status}` }
  }
  return resp.json() as Promise<{ success: boolean; error?: string }>
}

export function useWebhooks(): UseWebhooksReturn {
  const [config, setConfig] = useState<WebhookConfig>(defaultConfig)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchWebhookConfig()
      .then((cfg) => {
        setConfig(cfg)
        setLoading(false)
      })
      .catch((err) => {
        // If endpoint doesn't exist yet, use defaults
        console.error('Failed to load webhook config:', err)
        setLoading(false)
      })
  }, [])

  const updateConfig = useCallback(async (newConfig: WebhookConfig) => {
    setSaving(true)
    setError(null)
    try {
      await saveWebhookConfig(newConfig)
      setConfig(newConfig)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    } finally {
      setSaving(false)
    }
  }, [])

  const testAdapter = useCallback(async (index: number): Promise<{ success: boolean; error?: string }> => {
    setError(null)
    try {
      return await testWebhookAdapter(index)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  }, [])

  const addAdapter = useCallback((type: WebhookAdapter['type']) => {
    setConfig((prev) => ({
      ...prev,
      adapters: [...prev.adapters, { type }],
    }))
  }, [])

  const removeAdapter = useCallback((index: number) => {
    setConfig((prev) => ({
      ...prev,
      adapters: prev.adapters.filter((_, i) => i !== index),
    }))
  }, [])

  return {
    config,
    loading,
    saving,
    error,
    updateConfig,
    testAdapter,
    addAdapter,
    removeAdapter,
  }
}
