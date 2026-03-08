import { useState, useEffect } from 'react'
import { getConfig, saveConfig } from '../api'
import { SAWConfig } from '../types'

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { value: 'claude-haiku-3-5', label: 'Claude Haiku 3.5' },
]

interface SettingsScreenProps {
  onClose: () => void
}

export default function SettingsScreen({ onClose }: SettingsScreenProps): JSX.Element {
  const [config, setConfig] = useState<SAWConfig>({
    repo: { path: '' },
    agent: { scout_model: 'claude-sonnet-4-5', wave_model: 'claude-sonnet-4-5' },
    quality: { require_tests: false, require_lint: false, block_on_failure: false },
    appearance: { theme: 'system' },
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState(false)

  useEffect(() => {
    getConfig()
      .then(c => {
        setConfig(c)
        setLoading(false)
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await saveConfig(config)
      setSavedMsg(true)
      setTimeout(() => {
        setSavedMsg(false)
        onClose()
      }, 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading settings...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 gap-6 max-w-2xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Settings</h2>
      </div>

      {error && (
        <p className="text-destructive text-sm">{error}</p>
      )}

      {/* Repo section */}
      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
        <h3 className="text-sm font-medium">Repository</h3>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="settings-repo-path">
            Repo path
          </label>
          <input
            id="settings-repo-path"
            type="text"
            value={config.repo.path}
            onChange={e => setConfig(c => ({ ...c, repo: { path: e.target.value } }))}
            placeholder="/path/to/repo"
            className="text-sm px-3 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {/* Agent section */}
      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
        <h3 className="text-sm font-medium">Agent</h3>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="settings-scout-model">
            Scout model
          </label>
          <select
            id="settings-scout-model"
            value={config.agent.scout_model}
            onChange={e => setConfig(c => ({ ...c, agent: { ...c.agent, scout_model: e.target.value } }))}
            className="text-sm px-3 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
          >
            {MODEL_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="settings-wave-model">
            Wave model
          </label>
          <select
            id="settings-wave-model"
            value={config.agent.wave_model}
            onChange={e => setConfig(c => ({ ...c, agent: { ...c.agent, wave_model: e.target.value } }))}
            className="text-sm px-3 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
          >
            {MODEL_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Quality Gates section */}
      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
        <h3 className="text-sm font-medium">Quality Gates</h3>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.quality.require_tests}
            onChange={e => setConfig(c => ({ ...c, quality: { ...c.quality, require_tests: e.target.checked } }))}
            className="rounded border-border accent-primary"
          />
          <span className="text-sm">Require tests</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.quality.require_lint}
            onChange={e => setConfig(c => ({ ...c, quality: { ...c.quality, require_lint: e.target.checked } }))}
            className="rounded border-border accent-primary"
          />
          <span className="text-sm">Require lint</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={config.quality.block_on_failure}
            onChange={e => setConfig(c => ({ ...c, quality: { ...c.quality, block_on_failure: e.target.checked } }))}
            className="rounded border-border accent-primary"
          />
          <span className="text-sm">Block on failure</span>
        </label>
      </div>

      {/* Appearance section */}
      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
        <h3 className="text-sm font-medium">Appearance</h3>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="settings-theme">
            Theme
          </label>
          <select
            id="settings-theme"
            value={config.appearance.theme}
            onChange={e => setConfig(c => ({ ...c, appearance: { theme: e.target.value as 'system' | 'light' | 'dark' } }))}
            className="text-sm px-3 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 justify-end pb-2">
        {savedMsg && (
          <span className="text-xs text-green-600 dark:text-green-400">Saved!</span>
        )}
        <button
          onClick={onClose}
          className="text-sm px-3 py-1.5 rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
          disabled={saving}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-sm px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
