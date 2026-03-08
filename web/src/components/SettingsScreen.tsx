import { useState, useEffect } from 'react'
import { getConfig, saveConfig } from '../api'
import { SAWConfig, RepoEntry } from '../types'
import DirPicker from './DirPicker'

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { value: 'claude-haiku-3-5', label: 'Claude Haiku 3.5' },
]

interface SettingsScreenProps {
  onClose: () => void
  onReposChange?: (repos: RepoEntry[]) => void
}

export default function SettingsScreen({ onClose, onReposChange }: SettingsScreenProps): JSX.Element {
  const [config, setConfig] = useState<SAWConfig>({
    repos: [],
    repo: { path: '' },
    agent: { scout_model: 'claude-sonnet-4-5', wave_model: 'claude-sonnet-4-5' },
    quality: { require_tests: false, require_lint: false, block_on_failure: false },
    appearance: { theme: 'system' },
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState(false)
  const [repoErrors, setRepoErrors] = useState<string | null>(null)

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

  function updateRepo(index: number, field: keyof RepoEntry, value: string) {
    setConfig(c => {
      const repos = c.repos.map((r, i) =>
        i === index ? { ...r, [field]: value } : r
      )
      return { ...c, repos }
    })
    setRepoErrors(null)
  }

  function addRepo() {
    setConfig(c => ({ ...c, repos: [...c.repos, { name: '', path: '' }] }))
  }

  function removeRepo(index: number) {
    setConfig(c => ({ ...c, repos: c.repos.filter((_, i) => i !== index) }))
    setRepoErrors(null)
  }

  async function handleSave() {
    // Validate: every repo must have a non-empty path
    const hasEmptyPath = config.repos.some(r => r.path.trim() === '')
    if (hasEmptyPath) {
      setRepoErrors('All repositories must have a path set.')
      return
    }

    // Default name to last path segment if blank
    const normalizedRepos: RepoEntry[] = config.repos.map(r => ({
      name: r.name.trim() !== '' ? r.name.trim() : r.path.split('/').filter(Boolean).pop() ?? r.path,
      path: r.path,
    }))

    const configToSave: SAWConfig = { ...config, repos: normalizedRepos }

    setSaving(true)
    setError(null)
    setRepoErrors(null)
    try {
      await saveConfig(configToSave)
      setConfig(configToSave)
      onReposChange?.(normalizedRepos)
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
        <h3 className="text-sm font-medium">Repositories</h3>

        {config.repos.length === 0 && (
          <p className="text-xs text-muted-foreground">No repositories configured. Add one below.</p>
        )}

        {config.repos.map((repo, index) => (
          <div key={index} className="flex items-start gap-2">
            <input
              type="text"
              value={repo.name}
              onChange={e => updateRepo(index, 'name', e.target.value)}
              placeholder="name"
              className="w-24 text-xs font-mono px-2 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex-1">
              <DirPicker
                value={repo.path}
                onChange={path => updateRepo(index, 'path', path)}
              />
            </div>
            <button
              type="button"
              onClick={() => removeRepo(index)}
              className="text-xs text-muted-foreground hover:text-destructive mt-1.5 px-1"
              title="Remove repository"
            >
              &times;
            </button>
          </div>
        ))}

        {repoErrors && (
          <p className="text-xs text-destructive">{repoErrors}</p>
        )}

        <button
          type="button"
          onClick={addRepo}
          className="self-start text-xs px-3 py-1.5 rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
        >
          + Add repo
        </button>
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
