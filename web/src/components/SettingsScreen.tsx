import { useState, useEffect, useCallback } from 'react'
import { X, CheckCircle2 } from 'lucide-react'
import { getConfig, saveConfig } from '../api'
import { SAWConfig, RepoEntry } from '../types'
import { sawClient } from '../lib/apiClient'
import DirPicker from './DirPicker'
import ModelPicker from './ModelPicker'
import { Button } from './ui/button'
import NotificationSettings from './NotificationSettings'
import { useNotifications } from '../hooks/useNotifications'

interface RepoValidationResult {
  valid: boolean
  error: string
  errorCode: string
}

interface SettingsScreenProps {
  onClose: () => void
  onReposChange?: (repos: RepoEntry[]) => void
}

export default function SettingsScreen({ onClose, onReposChange }: SettingsScreenProps): JSX.Element {
  const { preferences, updatePreferences, browserPermission, requestPermission } = useNotifications()

  const [config, setConfig] = useState<SAWConfig>({
    repos: [],
    repo: { path: '' },
    agent: { scout_model: 'claude-sonnet-4-6', wave_model: 'claude-sonnet-4-6', integration_model: 'claude-sonnet-4-6', chat_model: 'claude-sonnet-4-6' },
    quality: { require_tests: false, require_lint: false, block_on_failure: false },
    appearance: { theme: 'system' },
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState(false)
  const [repoErrors, setRepoErrors] = useState<string | null>(null)
  const [repoValidation, setRepoValidation] = useState<Record<number, RepoValidationResult | null>>({})

  useEffect(() => {
    getConfig()
      .then(c => {
        setConfig(prev => ({
          ...prev,
          ...c,
          repos: c.repos ?? prev.repos,
          repo: c.repo ?? prev.repo,
          agent: { ...prev.agent, ...c.agent },
          quality: { ...prev.quality, ...c.quality },
          appearance: { ...prev.appearance, theme: c.appearance?.theme || prev.appearance.theme },
        }))
        setLoading(false)
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [])

  const validateRepoPath = useCallback(async (index: number, path: string) => {
    if (!path.trim()) {
      // Don't validate empty paths — user may not have typed yet.
      setRepoValidation(prev => ({ ...prev, [index]: null }))
      return
    }
    try {
      const data = await sawClient.config.validateRepo(path)
      setRepoValidation(prev => ({
        ...prev,
        [index]: {
          valid: data.valid,
          error: data.error ?? '',
          errorCode: data.error_code ?? '',
        },
      }))
    } catch {
      // Network failure — clear validation, don't block save
      setRepoValidation(prev => ({ ...prev, [index]: null }))
    }
  }, [])

  function updateRepo(index: number, field: keyof RepoEntry, value: string) {
    setConfig(c => {
      const repos = c.repos.map((r, i) =>
        i === index ? { ...r, [field]: value } : r
      )
      return { ...c, repos }
    })
    setRepoErrors(null)
    // Clear validation result when path changes so stale status isn't shown.
    if (field === 'path') {
      setRepoValidation(prev => ({ ...prev, [index]: null }))
    }
  }

  function addRepo() {
    setConfig(c => ({ ...c, repos: [...c.repos, { name: '', path: '' }] }))
  }

  function removeRepo(index: number) {
    setConfig(c => ({ ...c, repos: c.repos.filter((_, i) => i !== index) }))
    setRepoErrors(null)
    setRepoValidation(prev => {
      const next: Record<number, RepoValidationResult | null> = {}
      Object.entries(prev).forEach(([k, v]) => {
        const ki = Number(k)
        if (ki < index) next[ki] = v
        else if (ki > index) next[ki - 1] = v
        // ki === index is dropped
      })
      return next
    })
  }

  // Returns true if any repo has been validated and found invalid.
  const hasInvalidRepo = Object.values(repoValidation).some(v => v !== null && !v.valid)

  async function handleSave() {
    // Validate: every repo must have a non-empty path
    const hasEmptyPath = config.repos.some(r => r.path.trim() === '')
    if (hasEmptyPath) {
      setRepoErrors('All repositories must have a path set.')
      return
    }

    // Block save if any repo has a known invalid validation result.
    if (hasInvalidRepo) {
      setRepoErrors('Please fix invalid repository paths before saving.')
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
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
        Loading settings...
      </div>
    )
  }

  return (
    <div className="flex flex-col p-6 gap-6 max-w-2xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Settings</h2>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          title="Close settings"
        >
          <X size={16} />
        </button>
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

        {config.repos.map((repo, index) => {
          const validation = repoValidation[index] ?? null
          return (
            <div key={index} className="flex flex-col gap-1">
              <div className="flex items-start gap-2">
                <input
                  type="text"
                  value={repo.name}
                  onChange={e => updateRepo(index, 'name', e.target.value)}
                  placeholder="name"
                  className="w-24 text-xs font-mono px-2 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <div
                  className="flex-1 relative"
                  onBlur={e => {
                    // Trigger validation when focus leaves the DirPicker container.
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      validateRepoPath(index, repo.path)
                    }
                  }}
                >
                  <DirPicker
                    value={repo.path}
                    onChange={path => updateRepo(index, 'path', path)}
                  />
                  {validation?.valid && (
                    <span className="absolute right-8 top-1/2 -translate-y-1/2 text-green-500 pointer-events-none">
                      <CheckCircle2 size={14} />
                    </span>
                  )}
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
              {validation && !validation.valid && (
                <p className="text-xs text-destructive ml-26 pl-1">
                  {validation.errorCode === 'not_found' && 'Path does not exist'}
                  {validation.errorCode === 'not_git' && 'Not a git repository (run `git init` first)'}
                  {validation.errorCode === 'no_commits' && "Repository has no commits (run `git commit --allow-empty -m 'init'` first)"}
                  {!['not_found', 'not_git', 'no_commits'].includes(validation.errorCode) && validation.error}
                </p>
              )}
            </div>
          )
        })}

        {repoErrors && (
          <p className="text-xs text-destructive">{repoErrors}</p>
        )}

        <Button type="button" onClick={addRepo} variant="outline" size="sm" className="self-start">
          + Add repo
        </Button>
      </div>

      {/* Agent section */}
      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
        <h3 className="text-sm font-medium">Agent</h3>
        <ModelPicker
          id="settings-scout-model"
          label="Scout model"
          value={config.agent.scout_model}
          onChange={v => setConfig(c => ({ ...c, agent: { ...c.agent, scout_model: v } }))}
        />
        <ModelPicker
          id="settings-wave-model"
          label="Wave model"
          value={config.agent.wave_model}
          onChange={v => setConfig(c => ({ ...c, agent: { ...c.agent, wave_model: v } }))}
        />
        <ModelPicker
          id="settings-integration-model"
          label="Integration model"
          value={config.agent.integration_model ?? ''}
          onChange={v => setConfig(c => ({ ...c, agent: { ...c.agent, integration_model: v } }))}
        />
        <ModelPicker
          id="settings-chat-model"
          label="Chat model"
          value={config.agent.chat_model ?? ''}
          onChange={v => setConfig(c => ({ ...c, agent: { ...c.agent, chat_model: v } }))}
        />
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
        {/* Code Review section within Quality Gates */}
        <div className="pt-2 border-t border-border mt-1 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground font-medium">AI Code Review</p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.quality.code_review?.enabled ?? false}
              onChange={e => setConfig(c => ({
                ...c,
                quality: {
                  ...c.quality,
                  code_review: { ...c.quality.code_review, enabled: e.target.checked,
                    blocking: c.quality.code_review?.blocking ?? false,
                    model: c.quality.code_review?.model ?? '',
                    threshold: c.quality.code_review?.threshold ?? 70 }
                }
              }))}
              className="rounded border-border accent-primary"
            />
            <span className="text-sm">Enable AI code review</span>
          </label>
          {config.quality.code_review?.enabled && (
            <>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.quality.code_review?.blocking ?? false}
                  onChange={e => setConfig(c => ({
                    ...c,
                    quality: { ...c.quality, code_review: { ...c.quality.code_review!, blocking: e.target.checked } }
                  }))}
                  className="rounded border-border accent-primary"
                />
                <span className="text-sm">Block on failing review</span>
              </label>
              <div className="flex items-center gap-3">
                <label className="text-xs text-muted-foreground w-20" htmlFor="review-threshold">
                  Pass threshold
                </label>
                <input
                  id="review-threshold"
                  type="number"
                  min={0} max={100}
                  value={config.quality.code_review?.threshold ?? 70}
                  onChange={e => setConfig(c => ({
                    ...c,
                    quality: { ...c.quality, code_review: { ...c.quality.code_review!, threshold: Number(e.target.value) } }
                  }))}
                  className="w-16 text-xs font-mono px-2 py-1 rounded-md border border-border bg-background text-foreground"
                />
                <span className="text-xs text-muted-foreground">/ 100</span>
              </div>
            </>
          )}
        </div>
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

      {/* Notifications section */}
      <div className="rounded-lg border border-border bg-card p-4">
        <NotificationSettings
          preferences={preferences}
          onUpdate={updatePreferences}
          browserPermission={browserPermission}
          onRequestPermission={requestPermission}
        />
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 justify-end pb-2">
        {savedMsg && (
          <span className="text-xs text-green-600 dark:text-green-400">Saved!</span>
        )}
        <Button onClick={onClose} variant="outline" disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving || hasInvalidRepo}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
