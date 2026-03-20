import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { listImpls, fetchImpl, approveImpl, rejectImpl, startWave, deleteImpl, getConfig, saveConfig, fetchInterruptedSessions } from './api'
import { IMPLDocResponse, IMPLListEntry, RepoEntry } from './types'
import ReviewScreen from './components/ReviewScreen'
import { LiveView } from './components/LiveRail'
import LiveRail from './components/LiveRail'
import SettingsScreen from './components/SettingsScreen'
import CommandPalette from './components/CommandPalette'
import { useResizableDivider } from './hooks/useResizableDivider'
import ModelPicker from './components/ModelPicker'
import PipelineView from './components/PipelineView'
import ProgramBoard from './components/ProgramBoard'
import { listPrograms } from './programApi'
import { InterruptedSession } from './types'
import type { ProgramDiscovery } from './types/program'
import { useNotifications } from './hooks/useNotifications'
import { useGlobalEvents } from './hooks/useGlobalEvents'
import { useModal } from './hooks/useModal'
import ToastContainer from './components/ToastContainer'
import { AppLayout } from './components/layout/AppLayout'
import { AppHeader } from './components/layout/AppHeader'
import { SidebarNav } from './components/layout/SidebarNav'


function WelcomeCard({ onOpenSettings }: { onOpenSettings: () => void }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <div className="border border-border rounded-lg bg-card p-8 max-w-lg w-full space-y-6">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">Welcome to Scout-and-Wave</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Scout-and-Wave uses AI agents to plan and implement features in parallel.
            A Scout agent reads your codebase and produces an implementation plan (IMPL).
            You review the plan, approve it, and parallel Wave agents implement it in isolated git branches.
          </p>
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Get started</p>
          <p className="text-sm text-muted-foreground">
            First, add a repository in Settings so Scout knows which codebase to analyze.
          </p>
          <button
            onClick={onOpenSettings}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Open Settings
          </button>
        </div>
        <div className="border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Example:</span>{' '}
            Once a repository is configured, try creating a plan like{' '}
            <span className="font-mono text-xs">"Add a dark mode toggle to the settings screen"</span>.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const { toasts, dismissToast } = useNotifications()
  const settingsModal = useModal('settings')

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [entries, setEntries] = useState<IMPLListEntry[]>([])
  const [liveView, setLiveView] = useState<LiveView>(null)
  const [impl, setImpl] = useState<IMPLDocResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejected, setRejected] = useState(false)

  const [repos, setRepos] = useState<RepoEntry[]>([])
  const [activeRepoIndex, setActiveRepoIndex] = useState<number>(0)
  const activeRepo: RepoEntry | null = repos[activeRepoIndex] ?? null

  const [scoutModel, setScoutModel] = useState<string>('claude-sonnet-4-6')
  const [scaffoldModel, setScaffoldModel] = useState<string>('claude-sonnet-4-6')
  const [waveModel, setWaveModel] = useState<string>('claude-sonnet-4-6')
  const [integrationModel, setIntegrationModel] = useState<string>('claude-sonnet-4-6')
  const [chatModel, setChatModel] = useState<string>('claude-sonnet-4-6')
  const [plannerModel, setPlannerModel] = useState<string>('claude-sonnet-4-6')

  const [pickerOpen, setPickerOpen] = useState<'scout' | 'scaffold' | 'wave' | 'integration' | 'chat' | 'planner' | 'all' | null>(null)

  const [interruptedSessions, setInterruptedSessions] = useState<InterruptedSession[]>([])
  const [sseConnected, setSseConnected] = useState(false)
  const [sseRefreshTick, setSseRefreshTick] = useState(0)
  const [showPalette, setShowPalette] = useState(false)
  const [showPipeline, setShowPipeline] = useState(false)
  const [showPrograms, setShowPrograms] = useState(false)
  const [programs, setPrograms] = useState<ProgramDiscovery[]>([])
  const [selectedProgramSlug, setSelectedProgramSlug] = useState<string | null>(null)

  // Close model picker on Escape
  useEffect(() => {
    if (!pickerOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(null)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [pickerOpen])

  function handleReposChange(updated: RepoEntry[]): void {
    setRepos(updated)
  }
  async function handleRemoveRepo(repoName: string): Promise<void> {
    const updated = repos.filter(r => (r.name || r.path) !== repoName)
    try {
      const cfg = await getConfig()
      await saveConfig({ ...cfg, repos: updated })
      setRepos(updated)
    } catch (err) {
      console.error('Failed to remove repo:', err)
    }
  }
  function handleRepoSwitch(index: number): void {
    setActiveRepoIndex(index)
  }

  const { leftWidthPx, dividerProps } = useResizableDivider({ initialWidthPx: Math.round(window.innerWidth * 0.15) - 20, minWidthPx: 140, maxFraction: 0.15 })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const [rightWidthPx, setRightWidthPx] = useState(() => Math.min(680, Math.round(window.innerWidth * 0.60)))

  // Subscribe to global server events so the IMPL list stays in sync
  // with any external changes (CLI scout runs, wave completion, approve/reject).
  const handleImplListUpdated = useCallback(() => {
    setSseConnected(true)
    listImpls().then(setEntries).catch(() => {})
    fetchInterruptedSessions().then(setInterruptedSessions).catch(() => {})
    setSseRefreshTick(t => t + 1)
  }, [])
  useGlobalEvents({ impl_list_updated: handleImplListUpdated })

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
      setScoutModel(config.agent?.scout_model || 'claude-sonnet-4-6')
      setScaffoldModel(config.agent?.scaffold_model || 'claude-sonnet-4-6')
      setWaveModel(config.agent?.wave_model || 'claude-sonnet-4-6')
      setIntegrationModel(config.agent?.integration_model || 'claude-sonnet-4-6')
      setChatModel(config.agent?.chat_model || 'claude-sonnet-4-6')
      setPlannerModel(config.agent?.planner_model || 'claude-sonnet-4-6')
    }).catch(() => {})
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  // Refetch IMPL list when repos configuration changes
  useEffect(() => {
    if (repos.length > 0) {
      listImpls().then(setEntries).catch(() => {})
    }
  }, [repos])

  // Command palette keyboard shortcut (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowPalette(v => !v)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  async function handleSelect(selected: string) {
    setSelectedSlug(selected)
    setShowPipeline(false)
    setRejected(false)
    setLoading(true)
    setError(null)
    try {
      const data = await fetchImpl(selected)
      setImpl(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleApprove() {
    setLoading(true)
    setError(null)
    try {
      await approveImpl(selectedSlug!)
      setLiveView('wave')
      await new Promise(resolve => setTimeout(resolve, 300))
      try {
        await startWave(selectedSlug!)
      } catch (startErr) {
        const msg = startErr instanceof Error ? startErr.message : String(startErr)
        if (msg.includes('409')) {
          // Already running — stay on wave view
        } else {
          setLiveView(null)
          setError(`Wave failed to start: ${msg}`)
        }
      }
    } catch (err) {
      setLiveView(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  function handleViewWaves() {
    setLiveView(prev => prev === 'wave' ? null : 'wave')
  }

  async function handleReject() {
    setLoading(true)
    setError(null)
    try {
      await rejectImpl(selectedSlug!)
      setRejected(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(slug: string) {
    try {
      await deleteImpl(slug)
      const updated = await listImpls()
      setEntries(updated)
      if (selectedSlug === slug) {
        setSelectedSlug(null)
        setImpl(null)
        setRejected(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function saveModel(field: 'scout' | 'scaffold' | 'wave' | 'integration' | 'chat' | 'planner' | 'all', value: string) {
    try {
      const cfg = await getConfig()
      const updated = {
        ...cfg,
        agent: {
          ...cfg.agent,
          ...(field === 'scout' && { scout_model: value }),
          ...(field === 'scaffold' && { scaffold_model: value }),
          ...(field === 'wave' && { wave_model: value }),
          ...(field === 'integration' && { integration_model: value }),
          ...(field === 'chat' && { chat_model: value }),
          ...(field === 'planner' && { planner_model: value }),
          ...(field === 'all' && { scout_model: value, scaffold_model: value, wave_model: value, integration_model: value, chat_model: value, planner_model: value }),
        }
      }
      await saveConfig(updated)
      if (field === 'scout') setScoutModel(value)
      if (field === 'scaffold') setScaffoldModel(value)
      if (field === 'wave') setWaveModel(value)
      if (field === 'integration') setIntegrationModel(value)
      if (field === 'chat') setChatModel(value)
      if (field === 'planner') setPlannerModel(value)
      if (field === 'all') { setScoutModel(value); setScaffoldModel(value); setWaveModel(value); setIntegrationModel(value); setChatModel(value); setPlannerModel(value) }
    } catch { /* ignore */ }
  }

  async function handleScoutReady() {
    try {
      const updated = await listImpls()
      setEntries(updated)
    } catch {
      // non-fatal
    }
  }

  async function handleScoutComplete(slug: string) {
    try {
      const updated = await listImpls()
      setEntries(updated)
    } catch {
      // non-fatal
    }
    if (slug) {
      setSelectedSlug(slug)
      setLoading(true)
      setError(null)
      try {
        const data = await fetchImpl(slug)
        setImpl(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }
    setLiveView(null)
  }

  function handleSettingsClose() {
    settingsModal.close()
    getConfig().then(config => {
      setScoutModel(config.agent?.scout_model ?? '')
      setScaffoldModel(config.agent?.scaffold_model ?? '')
      setWaveModel(config.agent?.wave_model ?? '')
      setIntegrationModel(config.agent?.integration_model ?? '')
      setChatModel(config.agent?.chat_model ?? '')
      setPlannerModel(config.agent?.planner_model ?? '')
    }).catch(() => {})
  }

  // Model picker dropdown content
  const modelPickerContent = pickerOpen === 'all' ? (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(null)} />
      <div className="absolute top-full right-0 mt-2 z-50 bg-popover border border-border rounded-lg shadow-2xl p-4 w-[520px] animate-in fade-in slide-in-from-top-2 duration-200 space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Agent Models</p>
        {(['planner', 'scout', 'scaffold', 'wave', 'integration', 'chat'] as const).map(field => {
          const model = field === 'planner' ? plannerModel : field === 'scout' ? scoutModel : field === 'scaffold' ? scaffoldModel : field === 'wave' ? waveModel : field === 'integration' ? integrationModel : chatModel
          const label = field.charAt(0).toUpperCase() + field.slice(1)
          return (
            <ModelPicker
              key={field}
              id={`header-${field}-model`}
              label={`${label} Model`}
              value={model}
              onChange={value => saveModel(field, value)}
            />
          )
        })}
      </div>
    </>
  ) : null

  // Main content area
  const mainContent = showPrograms ? (
    selectedProgramSlug ? (
      <ProgramBoard
        programSlug={selectedProgramSlug}
        onSelectImpl={(slug) => { setShowPrograms(false); handleSelect(slug) }}
      />
    ) : (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
        <p className="text-sm font-medium text-foreground">No programs yet</p>
        <p className="text-xs text-muted-foreground mt-1">Programs coordinate multiple related implementation plans as a single unit. Use the New Program button above to create one.</p>
      </div>
    )
  ) : showPipeline ? (
    <PipelineView
      onSelectImpl={(slug) => { setShowPipeline(false); handleSelect(slug) }}
      onSelectProgram={(programSlug) => {
        setShowPipeline(false)
        setShowPrograms(true)
        setSelectedProgramSlug(programSlug)
      }}
      onClose={() => setShowPipeline(false)}
    />
  ) : (
    <>
      {error && <p className="text-destructive text-sm p-4">{error}</p>}
      {loading && (
        <div className="p-6 space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="animate-pulse h-5 bg-muted rounded w-1/3" />
              <div className="animate-pulse h-3 bg-muted rounded w-2/3" />
              <div className="animate-pulse h-3 bg-muted rounded w-1/2" />
            </div>
          ))}
        </div>
      )}
      {rejected && <p className="text-orange-600 text-sm p-4">Plan rejected.</p>}
      {!loading && impl !== null && selectedSlug !== null && (
        <ReviewScreen slug={selectedSlug} impl={impl} onApprove={handleApprove} onReject={handleReject} onViewWaves={handleViewWaves} onRefreshImpl={handleSelect} repos={repos} chatModel={chatModel} refreshTick={sseRefreshTick} />
      )}
      {!loading && impl === null && !error && (
        repos.length === 0 ? (
          <WelcomeCard onOpenSettings={settingsModal.open} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="text-muted-foreground/30">
              <rect x="6" y="8" width="36" height="32" rx="3" stroke="currentColor" strokeWidth="2"/>
              <path d="M14 18h20M14 24h14M14 30h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <div>
              <p className="text-sm font-medium text-foreground">No plan selected</p>
              <p className="text-xs text-muted-foreground mt-1">Select a plan from the sidebar or create a new one with New Plan</p>
            </div>
          </div>
        )
      )}
    </>
  )

  // Right panel (LiveRail)
  const rightPanel = liveView !== null ? (
    <LiveRail
      slug={selectedSlug}
      liveView={liveView}
      widthPx={rightWidthPx}
      onScoutComplete={handleScoutComplete}
      onScoutReady={handleScoutReady}
      onRescout={() => setLiveView('scout')}
      onPlannerComplete={(slug) => {
        setLiveView(null)
        listPrograms().then(p => { setPrograms(p); if (slug) setSelectedProgramSlug(slug) }).catch(() => {})
        setShowPrograms(true)
        setShowPipeline(false)
        setSelectedSlug(null)
        setImpl(null)
      }}
      onClose={() => setLiveView(null)}
      repos={repos}
      activeRepo={activeRepo}
      onRepoSwitch={handleRepoSwitch}
    />
  ) : undefined

  return (
    <>
      <AppLayout
        header={
          <AppHeader
            onPipelineClick={() => { setShowPipeline(v => !v); setShowPrograms(false); if (!showPipeline) { setSelectedSlug(null); setImpl(null); setLiveView(null) } }}
            onNewPlanClick={() => setLiveView(v => v === 'scout' ? null : 'scout')}
            onProgramsClick={() => {
              setShowPrograms(v => !v)
              if (!showPrograms) { setShowPipeline(false); setSelectedSlug(null); setImpl(null); setLiveView(null) }
              if (!showPrograms && programs.length > 0) setSelectedProgramSlug(programs[0].slug)
            }}
            onNewProgramClick={() => setLiveView(v => v === 'planner' ? null : 'planner')}
            onSearchClick={() => setShowPalette(true)}
            onSettingsClick={settingsModal.toggle}
            onModelsClick={() => setPickerOpen(pickerOpen === 'all' ? null : 'all')}
            showPipeline={showPipeline}
            showPrograms={showPrograms}
            sseConnected={sseConnected}
            modelPickerOpen={pickerOpen === 'all'}
            modelPickerContent={modelPickerContent}
          />
        }
        sidebar={
          <SidebarNav
            showPrograms={showPrograms}
            programs={programs}
            selectedProgramSlug={selectedProgramSlug}
            onSelectProgram={setSelectedProgramSlug}
            interruptedSessions={interruptedSessions}
            entries={entries}
            selectedSlug={selectedSlug}
            onSelect={handleSelect}
            onDelete={handleDelete}
            loading={loading}
            repos={repos}
            onManageRepos={settingsModal.open}
            onRemoveRepo={(name) => void handleRemoveRepo(name)}
            onNewPlan={() => setLiveView(v => v === 'scout' ? null : 'scout')}
          />
        }
        main={mainContent}
        rightPanel={rightPanel}
        rightPanelWidth={rightWidthPx}
        onRightPanelResize={setRightWidthPx}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(c => !c)}
        sidebarWidth={leftWidthPx}
        sidebarDividerProps={dividerProps}
      />

      {settingsModal.isOpen && createPortal(
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40 bg-black/20" onClick={settingsModal.portalProps.onBackdropClick} />
          {/* Drawer */}
          <div className="fixed inset-y-0 right-0 z-50 w-[560px] max-w-[90vw] bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700 shadow-2xl overflow-y-auto">
            <SettingsScreen
              onClose={handleSettingsClose}
              onReposChange={handleReposChange}
            />
          </div>
        </>,
        document.body
      )}

      {showPalette && (
        <CommandPalette
          entries={entries}
          onSelect={(slug) => { handleSelect(slug); setShowPalette(false) }}
          onClose={() => setShowPalette(false)}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}
