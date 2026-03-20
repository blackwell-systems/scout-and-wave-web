import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { fetchImpl, approveImpl, rejectImpl, startWave, deleteImpl } from './api'
import { IMPLDocResponse } from './types'
import ReviewScreen from './components/ReviewScreen'
import { LiveView } from './components/LiveRail'
import LiveRail from './components/LiveRail'
import SettingsScreen from './components/SettingsScreen'
import CommandPalette from './components/CommandPalette'
import { useResizableDivider } from './hooks/useResizableDivider'
import ModelPicker from './components/ModelPicker'
import PipelineView from './components/PipelineView'
import ProgramBoard from './components/ProgramBoard'
import { useNotifications } from './hooks/useNotifications'
import { useModal } from './hooks/useModal'
import ToastContainer from './components/ToastContainer'
import { AppLayout } from './components/layout/AppLayout'
import { AppHeader } from './components/layout/AppHeader'
import { SidebarNav } from './components/layout/SidebarNav'
import { useAppContext } from './contexts/AppContext'


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

  // Shared state from AppContext (repos, entries, models, sseConnected, programs)
  const {
    repos, activeRepo, setActiveRepoIndex, setRepos,
    entries, refreshEntries,
    models, saveModel: contextSaveModel,
    sseConnected,
    programs, refreshPrograms,
  } = useAppContext()

  // UI-local state (only used within App.tsx)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [liveView, setLiveView] = useState<LiveView>(null)
  const [impl, setImpl] = useState<IMPLDocResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejected, setRejected] = useState(false)

  const [pickerOpen, setPickerOpen] = useState<'scout' | 'scaffold' | 'wave' | 'integration' | 'chat' | 'planner' | 'all' | null>(null)

  const [sseRefreshTick, setSseRefreshTick] = useState(0)
  const [showPalette, setShowPalette] = useState(false)
  const [showPipeline, setShowPipeline] = useState(false)
  const [showPrograms, setShowPrograms] = useState(false)
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

  // Bump refresh tick when entries change (SSE-driven via context)
  useEffect(() => {
    setSseRefreshTick(t => t + 1)
  }, [entries])

  const handleReposChange = useCallback((updated: typeof repos): void => {
    setRepos(updated)
  }, [setRepos])

  const handleRemoveRepo = useCallback(async (repoName: string): Promise<void> => {
    const { getConfig, saveConfig } = await import('./api')
    const updated = repos.filter(r => (r.name || r.path) !== repoName)
    try {
      const cfg = await getConfig()
      await saveConfig({ ...cfg, repos: updated })
      setRepos(updated)
    } catch (err) {
      console.error('Failed to remove repo:', err)
    }
  }, [repos, setRepos])

  const handleRepoSwitch = useCallback((index: number): void => {
    setActiveRepoIndex(index)
  }, [setActiveRepoIndex])

  const { leftWidthPx, dividerProps } = useResizableDivider({ initialWidthPx: Math.round(window.innerWidth * 0.15) - 20, minWidthPx: 140, maxFraction: 0.15 })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const [rightWidthPx, setRightWidthPx] = useState(() => Math.min(680, Math.round(window.innerWidth * 0.60)))

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

  // Notification permission request on mount
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  const handleSelect = useCallback(async (selected: string) => {
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
  }, [])

  const handleApprove = useCallback(async () => {
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
  }, [selectedSlug])

  const handleViewWaves = useCallback(() => {
    setLiveView(prev => prev === 'wave' ? null : 'wave')
  }, [])

  const handleReject = useCallback(async () => {
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
  }, [selectedSlug])

  const handleDelete = useCallback(async (slug: string) => {
    try {
      await deleteImpl(slug)
      await refreshEntries()
      if (selectedSlug === slug) {
        setSelectedSlug(null)
        setImpl(null)
        setRejected(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [selectedSlug, refreshEntries])

  const saveModel = useCallback(async (field: 'scout' | 'scaffold' | 'wave' | 'integration' | 'chat' | 'planner' | 'all', value: string) => {
    await contextSaveModel(field, value)
  }, [contextSaveModel])

  const handleScoutReady = useCallback(async () => {
    try {
      await refreshEntries()
    } catch {
      // non-fatal
    }
  }, [refreshEntries])

  const handleScoutComplete = useCallback(async (slug: string) => {
    try {
      await refreshEntries()
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
  }, [refreshEntries])

  const handleSettingsClose = useCallback(() => {
    settingsModal.close()
    // Models are managed by AppContext now; just refresh entries in case repos changed
    refreshEntries().catch(() => {})
  }, [settingsModal, refreshEntries])

  // Model picker dropdown content
  const modelPickerContent = pickerOpen === 'all' ? (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(null)} />
      <div className="absolute top-full right-0 mt-2 z-50 bg-popover border border-border rounded-lg shadow-2xl p-4 w-[520px] animate-in fade-in slide-in-from-top-2 duration-200 space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Agent Models</p>
        {(['planner', 'scout', 'scaffold', 'wave', 'integration', 'chat'] as const).map(field => {
          const model = models[field]
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
        <ReviewScreen slug={selectedSlug} impl={impl} onApprove={handleApprove} onReject={handleReject} onViewWaves={handleViewWaves} onRefreshImpl={handleSelect} repos={repos} chatModel={models.chat} refreshTick={sseRefreshTick} />
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
        refreshPrograms().then(() => { if (slug) setSelectedProgramSlug(slug) }).catch(() => {})
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
            interruptedSessions={[]}
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
