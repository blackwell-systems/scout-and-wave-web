import { useState, useEffect, useCallback } from 'react'
import { X, CheckCircle2, FolderGit2, Key, Bot, ShieldCheck, Palette, Bell } from 'lucide-react'
import { getConfig, saveConfig } from '../api'
import { SAWConfig, RepoEntry } from '../types'
import { sawClient } from '../lib/apiClient'
import DirPicker from './DirPicker'
import ModelPicker from './ModelPicker'
import { Button } from './ui/button'
import NotificationSettings from './NotificationSettings'
import WebhookSettings from './WebhookSettings'
import { useNotifications } from '../hooks/useNotifications'
import ProviderCard from './ProviderCard'
import type { ProviderFieldDef, ProviderValidationResponse } from './ProviderCard'
import SSOLoginButton from './SSOLoginButton'

interface RepoValidationResult {
  valid: boolean
  error: string
  errorCode: string
}

interface SettingsScreenProps {
  onClose: () => void
  onReposChange?: (repos: RepoEntry[]) => void
}

// Provider field definitions for each provider card
const ANTHROPIC_FIELDS: ProviderFieldDef[] = [
  { key: 'api_key', label: 'API Key', type: 'password' },
]

const OPENAI_FIELDS: ProviderFieldDef[] = [
  { key: 'api_key', label: 'API Key', type: 'password' },
]

const BEDROCK_FIELDS: ProviderFieldDef[] = [
  { key: 'profile', label: 'AWS Profile', type: 'text', optional: true },
  { key: 'region', label: 'Region', type: 'text' },
  { key: 'access_key_id', label: 'Access Key ID', type: 'password', optional: true },
  { key: 'secret_access_key', label: 'Secret Access Key', type: 'password', optional: true },
  { key: 'session_token', label: 'Session Token', type: 'password', optional: true },
]

interface ProvidersConfig {
  anthropic: Record<string, string>
  openai: Record<string, string>
  bedrock: Record<string, string>
}

const EMPTY_PROVIDERS: ProvidersConfig = {
  anthropic: { api_key: '' },
  openai: { api_key: '' },
  bedrock: { profile: '', region: '', access_key_id: '', secret_access_key: '', session_token: '' },
}

type SettingsSection = 'repos' | 'providers' | 'agent' | 'quality' | 'appearance' | 'notifications'

const SECTIONS: { id: SettingsSection; label: string; icon: typeof FolderGit2 }[] = [
  { id: 'repos', label: 'Repositories', icon: FolderGit2 },
  { id: 'providers', label: 'Providers', icon: Key },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'quality', label: 'Quality Gates', icon: ShieldCheck },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'notifications', label: 'Notifications', icon: Bell },
]

export default function SettingsScreen({ onClose, onReposChange }: SettingsScreenProps): JSX.Element {
  const { preferences, updatePreferences, browserPermission, requestPermission } = useNotifications()

  const [activeSection, setActiveSection] = useState<SettingsSection>('repos')
  const [config, setConfig] = useState<SAWConfig>({
    repos: [],
    repo: { path: '' },
    agent: { scout_model: 'claude-sonnet-4-6', wave_model: 'claude-sonnet-4-6', integration_model: 'claude-sonnet-4-6', chat_model: 'claude-sonnet-4-6' },
    quality: { require_tests: false, require_lint: false, block_on_failure: false },
    appearance: { theme: 'system', contrast: 'normal' },
  })
  const [providers, setProviders] = useState<ProvidersConfig>(EMPTY_PROVIDERS)
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
          appearance: { ...prev.appearance, ...c.appearance },
        }))
        const p = c.providers
        if (p) {
          setProviders({
            anthropic: { ...EMPTY_PROVIDERS.anthropic, ...p.anthropic },
            openai: { ...EMPTY_PROVIDERS.openai, ...p.openai },
            bedrock: { ...EMPTY_PROVIDERS.bedrock, ...p.bedrock },
          })
        }
        setLoading(false)
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [])

  const validateRepoPath = useCallback(async (index: number, path: string) => {
    if (!path.trim()) {
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
      })
      return next
    })
  }

  const hasInvalidRepo = Object.values(repoValidation).some(v => v !== null && !v.valid)

  async function validateProvider(provider: string, creds: Record<string, string>): Promise<ProviderValidationResponse> {
    const resp = await fetch(`/api/config/providers/${encodeURIComponent(provider)}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    })
    if (!resp.ok) {
      const text = await resp.text()
      return { valid: false, error: text || `HTTP ${resp.status}` }
    }
    return resp.json() as Promise<ProviderValidationResponse>
  }

  async function handleSave() {
    const hasEmptyPath = config.repos.some(r => r.path.trim() === '')
    if (hasEmptyPath) {
      setRepoErrors('All repositories must have a path set.')
      setActiveSection('repos')
      return
    }
    if (hasInvalidRepo) {
      setRepoErrors('Please fix invalid repository paths before saving.')
      setActiveSection('repos')
      return
    }

    const normalizedRepos: RepoEntry[] = config.repos.map(r => ({
      name: r.name.trim() !== '' ? r.name.trim() : r.path.split('/').filter(Boolean).pop() ?? r.path,
      path: r.path,
    }))

    const configToSave: SAWConfig & { providers: ProvidersConfig } = { ...config, repos: normalizedRepos, providers }

    setSaving(true)
    setError(null)
    setRepoErrors(null)
    try {
      await saveConfig(configToSave)
      setConfig(configToSave)
      onReposChange?.(normalizedRepos)
      window.dispatchEvent(new CustomEvent('saw:contrast-changed', { detail: configToSave.appearance.contrast }))
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
    <div className="flex flex-col h-full max-h-[80vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
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
        <p className="text-destructive text-sm px-6 pt-3">{error}</p>
      )}

      {/* Sidebar + Content */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <nav className="w-48 shrink-0 border-r border-border py-2 overflow-y-auto">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left transition-colors ${
                activeSection === id
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
            >
              <Icon size={15} className="shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-xl">
            {activeSection === 'repos' && (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-medium">Repositories</h3>

                {config.repos.length === 0 && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>No repositories configured. Add one below, or run <code className="bg-muted px-1 py-0.5 rounded text-[11px]">sawtools init</code> in your project directory to auto-generate a config.</p>
                  </div>
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
            )}

            {activeSection === 'providers' && (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-medium">Providers</h3>
                <p className="text-xs text-muted-foreground">Leave empty to use environment variables.</p>

                <ProviderCard
                  provider="anthropic"
                  label="Anthropic"
                  fields={ANTHROPIC_FIELDS}
                  config={providers.anthropic}
                  onChange={c => setProviders(prev => ({ ...prev, anthropic: c }))}
                  onValidate={() => validateProvider('anthropic', providers.anthropic)}
                />

                <div className="border-t border-border" />

                <ProviderCard
                  provider="openai"
                  label="OpenAI"
                  fields={OPENAI_FIELDS}
                  config={providers.openai}
                  onChange={c => setProviders(prev => ({ ...prev, openai: c }))}
                  onValidate={() => validateProvider('openai', providers.openai)}
                />

                <div className="border-t border-border" />

                <ProviderCard
                  provider="bedrock"
                  label="AWS Bedrock"
                  fields={BEDROCK_FIELDS}
                  config={providers.bedrock}
                  onChange={c => setProviders(prev => ({ ...prev, bedrock: c }))}
                  onValidate={() => validateProvider('bedrock', providers.bedrock)}
                />

                <div className="border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground mb-2">
                    Use SSO Login when your AWS profile is configured for SSO in ~/.aws/config
                  </p>
                  <SSOLoginButton
                    profile={providers.bedrock.profile || ''}
                    region={providers.bedrock.region || ''}
                    onComplete={() => validateProvider('bedrock', providers.bedrock)}
                    onError={(error) => setError(error)}
                  />
                </div>
              </div>
            )}

            {activeSection === 'agent' && (
              <div className="flex flex-col gap-3">
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
            )}

            {activeSection === 'quality' && (
              <div className="flex flex-col gap-3">
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
            )}

            {activeSection === 'appearance' && (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-medium">Appearance</h3>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-muted-foreground" htmlFor="settings-theme">
                    Theme
                  </label>
                  <select
                    id="settings-theme"
                    value={config.appearance.theme}
                    onChange={e => setConfig(c => ({ ...c, appearance: { ...c.appearance, theme: e.target.value as 'system' | 'light' | 'dark' } }))}
                    className="text-sm px-3 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground" htmlFor="settings-contrast">
                    High contrast
                  </label>
                  <input
                    id="settings-contrast"
                    type="checkbox"
                    checked={config.appearance.contrast === 'high'}
                    onChange={e => setConfig(c => ({ ...c, appearance: { ...c.appearance, contrast: e.target.checked ? 'high' : 'normal' } }))}
                    className="cursor-pointer"
                  />
                </div>
              </div>
            )}

            {activeSection === 'notifications' && (
              <div className="flex flex-col gap-6">
                <NotificationSettings
                  preferences={preferences}
                  onUpdate={updatePreferences}
                  browserPermission={browserPermission}
                  onRequestPermission={requestPermission}
                />
                <div className="rounded-lg border border-border bg-card p-4">
                  <WebhookSettings />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer with save/cancel */}
      <div className="flex items-center gap-3 justify-end px-6 py-3 border-t border-border shrink-0">
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
