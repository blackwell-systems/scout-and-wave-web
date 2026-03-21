import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { listImpls, getConfig, saveConfig, fetchInterruptedSessions } from '../api'
import { listPrograms } from '../programApi'
import { useGlobalEvents } from '../hooks/useGlobalEvents'
import type { IMPLListEntry, RepoEntry, InterruptedSession } from '../types'
import type { ProgramDiscovery } from '../types/program'
import { type ModelRole, defaultModels } from '../types/models'

export interface AppContextValue {
  repos: RepoEntry[]
  activeRepo: RepoEntry | null
  activeRepoIndex: number
  setActiveRepoIndex: (index: number) => void
  setRepos: (repos: RepoEntry[]) => void
  entries: IMPLListEntry[]
  refreshEntries: () => Promise<void>
  models: Record<ModelRole, string>
  saveModel: (field: ModelRole | 'all', value: string) => Promise<void>
  sseConnected: boolean
  programs: ProgramDiscovery[]
  refreshPrograms: () => Promise<void>
  interruptedSessions: InterruptedSession[]
  runningSlugs: Set<string>
}

const defaultValue: AppContextValue = {
  repos: [],
  activeRepo: null,
  activeRepoIndex: 0,
  setActiveRepoIndex: () => {},
  setRepos: () => {},
  entries: [],
  refreshEntries: async () => {},
  models: { ...defaultModels },
  saveModel: async () => {},
  sseConnected: false,
  programs: [],
  refreshPrograms: async () => {},
  interruptedSessions: [],
  runningSlugs: new Set(),
}

export const AppContext = createContext<AppContextValue>(defaultValue)

export function useAppContext(): AppContextValue {
  return useContext(AppContext)
}

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [repos, setRepos] = useState<RepoEntry[]>([])
  const [activeRepoIndex, setActiveRepoIndex] = useState<number>(0)
  const activeRepo: RepoEntry | null = repos[activeRepoIndex] ?? null

  const [entries, setEntries] = useState<IMPLListEntry[]>([])
  const [sseConnected, setSseConnected] = useState(false)
  const [programs, setPrograms] = useState<ProgramDiscovery[]>([])

  const [models, setModels] = useState<Record<ModelRole, string>>({ ...defaultModels })

  const [interruptedSessions, setInterruptedSessions] = useState<InterruptedSession[]>([])
  const [runningSlugs, setRunningSlugs] = useState<Set<string>>(new Set())

  // Refresh interrupted sessions (called on multiple SSE events)
  const refreshInterrupted = useCallback(() => {
    fetchInterruptedSessions().then(setInterruptedSessions).catch(() => {})
  }, [])

  // Extract slug from SSE event data
  const extractSlug = useCallback((e: MessageEvent): string | null => {
    try { return JSON.parse(e.data)?.slug ?? null } catch { return null }
  }, [])

  // SSE lifecycle
  const handleSseOpen = useCallback(() => setSseConnected(true), [])
  const handleSseError = useCallback(() => setSseConnected(false), [])

  // SSE subscription: keep IMPL list in sync with external changes
  const handleImplListUpdated = useCallback(() => {
    listImpls().then(setEntries).catch(() => {})
    refreshInterrupted()
  }, [refreshInterrupted])

  // Wave start: mark slug as running
  const handleWaveStarted = useCallback((e: MessageEvent) => {
    const slug = extractSlug(e)
    if (slug) setRunningSlugs(prev => { const next = new Set(prev); next.add(slug); return next })
    refreshInterrupted()
  }, [extractSlug, refreshInterrupted])

  // Wave/finalize complete: remove slug from running, refresh sessions
  const handleWaveComplete = useCallback((e: MessageEvent) => {
    const slug = extractSlug(e)
    if (slug) setRunningSlugs(prev => { const next = new Set(prev); next.delete(slug); return next })
    refreshInterrupted()
  }, [extractSlug, refreshInterrupted])

  // Agent events: mark as running, refresh
  const handleAgentEvent = useCallback((e: MessageEvent) => {
    const slug = extractSlug(e)
    if (slug) setRunningSlugs(prev => { const next = new Set(prev); next.add(slug); return next })
    refreshInterrupted()
  }, [extractSlug, refreshInterrupted])

  useGlobalEvents({
    __open: handleSseOpen as any,
    __error: handleSseError as any,
    impl_list_updated: handleImplListUpdated,
    wave_started: handleWaveStarted,
    wave_complete: handleWaveComplete,
    agent_started: handleAgentEvent,
    agent_complete: handleAgentEvent,
    scaffold_complete: handleAgentEvent,
    finalize_complete: handleWaveComplete,
  })

  // Initial data fetch
  useEffect(() => {
    listImpls().then(setEntries).catch(() => {})
    listPrograms().then(setPrograms).catch(() => {})
    fetchInterruptedSessions().then(setInterruptedSessions).catch(() => {})
    getConfig().then(config => {
      if (config.repos && config.repos.length > 0) {
        setRepos(config.repos)
      } else if (config.repo?.path) {
        setRepos([{ name: 'repo', path: config.repo.path }])
      }
      const agentConfig = config.agent ?? {}
      setModels({
        scout: agentConfig.scout_model || defaultModels.scout,
        critic: agentConfig.critic_model || defaultModels.critic,
        scaffold: agentConfig.scaffold_model || defaultModels.scaffold,
        wave: agentConfig.wave_model || defaultModels.wave,
        integration: agentConfig.integration_model || defaultModels.integration,
        chat: agentConfig.chat_model || defaultModels.chat,
        planner: agentConfig.planner_model || defaultModels.planner,
      })
    }).catch(() => {})
  }, [])

  // Refetch IMPL list when repos change
  useEffect(() => {
    if (repos.length > 0) {
      listImpls().then(setEntries).catch(() => {})
    }
  }, [repos])

  const refreshEntries = useCallback(async () => {
    const updated = await listImpls()
    setEntries(updated)
  }, [])

  const refreshPrograms = useCallback(async () => {
    const updated = await listPrograms()
    setPrograms(updated)
  }, [])

  const handleSaveModel = useCallback(async (field: ModelRole | 'all', value: string) => {
    try {
      const cfg = await getConfig()
      const roleToConfigKey: Record<ModelRole, string> = {
        scout: 'scout_model', critic: 'critic_model', scaffold: 'scaffold_model',
        wave: 'wave_model', integration: 'integration_model', chat: 'chat_model',
        planner: 'planner_model',
      }
      const agentUpdate = field === 'all'
        ? Object.fromEntries(Object.values(roleToConfigKey).map(k => [k, value]))
        : { [roleToConfigKey[field]]: value }
      await saveConfig({ ...cfg, agent: { ...cfg.agent, ...agentUpdate } })
      if (field === 'all') {
        setModels(Object.fromEntries(Object.keys(defaultModels).map(k => [k, value])) as Record<ModelRole, string>)
      } else {
        setModels(prev => ({ ...prev, [field]: value }))
      }
    } catch { /* ignore */ }
  }, [])

  const value: AppContextValue = {
    repos,
    activeRepo,
    activeRepoIndex,
    setActiveRepoIndex,
    setRepos,
    entries,
    refreshEntries,
    models,
    saveModel: handleSaveModel,
    sseConnected,
    programs,
    refreshPrograms,
    interruptedSessions,
    runningSlugs,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
