import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { listImpls, fetchImpl, approveImpl, rejectImpl, startWave, deleteImpl, getConfig, saveConfig, fetchInterruptedSessions } from './api'
import { IMPLDocResponse, IMPLListEntry, RepoEntry } from './types'
import ReviewScreen from './components/ReviewScreen'
import DarkModeToggle from './components/DarkModeToggle'
import ImplList from './components/ImplList'
import ThemePicker from './components/ThemePicker'
import LiveRail from './components/LiveRail'
import { LiveView } from './components/LiveRail'
import SettingsScreen from './components/SettingsScreen'
import CommandPalette from './components/CommandPalette'
import { useResizableDivider } from './hooks/useResizableDivider'
import { ChevronLeft, ChevronRight, Settings, Search } from 'lucide-react'
import ModelPicker from './components/ModelPicker'
import ResumeBanner from './components/ResumeBanner'
import { InterruptedSession } from './types'


export default function App() {
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

  const [pickerOpen, setPickerOpen] = useState<'scout' | 'scaffold' | 'wave' | 'integration' | 'chat' | 'all' | null>(null)

  const [interruptedSessions, setInterruptedSessions] = useState<InterruptedSession[]>([])
  const [sseConnected, setSseConnected] = useState(false)
  const [sseRefreshTick, setSseRefreshTick] = useState(0)
  const [showPalette, setShowPalette] = useState(false)

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
  const [showSettings, setShowSettings] = useState(false)

  const [rightWidthPx, setRightWidthPx] = useState(() => Math.min(340, Math.round(window.innerWidth * 0.30)))
  const rightDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const onMove = (mv: MouseEvent) => {
      setRightWidthPx(Math.max(240, Math.min(window.innerWidth - mv.clientX, window.innerWidth * 0.30)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Subscribe to global server events so the IMPL list stays in sync
  // with any external changes (CLI scout runs, wave completion, approve/reject).
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onopen = () => setSseConnected(true)
    es.onerror = () => setSseConnected(false)
    es.addEventListener('impl_list_updated', () => {
      setSseConnected(true)
      listImpls().then(setEntries).catch(() => {})
      fetchInterruptedSessions().then(setInterruptedSessions).catch(() => {})
      setSseRefreshTick(t => t + 1)
    })
    return () => es.close()
  }, [])

  useEffect(() => {
    listImpls().then(setEntries).catch(() => {})
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

  // Command palette keyboard shortcut (⌘K / Ctrl+K)
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
      // Open the wave panel BEFORE starting execution so the SSE EventSource
      // is connected and ready to receive events. Without this, the goroutine
      // can publish all events before the client connects, causing a blank screen.
      setLiveView('wave')
      // Small delay to let React render the LiveRail and open the EventSource
      await new Promise(resolve => setTimeout(resolve, 300))
      try {
        await startWave(selectedSlug!)
      } catch (startErr) {
        const msg = startErr instanceof Error ? startErr.message : String(startErr)
        if (msg.includes('409')) {
          // Already running — stay on wave view, that's fine
        } else {
          // Wave failed to start — close the rail and show the error inline
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

  async function saveModel(field: 'scout' | 'scaffold' | 'wave' | 'integration' | 'chat' | 'all', value: string) {
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
          ...(field === 'all' && { scout_model: value, scaffold_model: value, wave_model: value, integration_model: value, chat_model: value }),
        }
      }
      await saveConfig(updated)
      if (field === 'scout') setScoutModel(value)
      if (field === 'scaffold') setScaffoldModel(value)
      if (field === 'wave') setWaveModel(value)
      if (field === 'integration') setIntegrationModel(value)
      if (field === 'chat') setChatModel(value)
      if (field === 'all') { setScoutModel(value); setScaffoldModel(value); setWaveModel(value); setIntegrationModel(value); setChatModel(value) }
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
      // non-fatal: sidebar will just not show the new entry until next refresh
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

  return (
    <>
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <header className="flex items-stretch justify-between h-[61px] border-b shrink-0">
        <div className="flex items-stretch">
          <button
            onClick={() => setLiveView(v => v === 'scout' ? null : 'scout')}
            className="flex items-center justify-center text-sm font-medium px-6 transition-colors border-r bg-blue-50/60 hover:bg-blue-100/80 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:hover:bg-blue-900/60 dark:text-blue-400 dark:border-blue-800"
          >
            New Plan
          </button>
          <button
            onClick={() => setShowPalette(true)}
            className="flex items-center gap-2 px-4 text-xs text-muted-foreground border-r border-border hover:bg-muted hover:text-foreground transition-colors"
            title="Search plans (⌘K)"
          >
            <Search size={13} />
            <kbd className="font-mono text-[10px] hidden sm:inline">⌘K</kbd>
          </button>
        </div>
        <div className="flex items-stretch">
          {(['scout', 'scaffold', 'wave', 'integration', 'chat'] as const).map(field => {
            const model = field === 'scout' ? scoutModel : field === 'scaffold' ? scaffoldModel : field === 'wave' ? waveModel : field === 'integration' ? integrationModel : chatModel
            const label = field.charAt(0).toUpperCase() + field.slice(1)
            return (
              <div key={field} className="relative flex items-stretch border-r border-border">
                <button
                  title={`${label} model: ${model}\nClick to configure`}
                  onClick={() => setPickerOpen(field)}
                  className="flex items-center gap-2 px-4 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors group"
                >
                  <span className="text-xs text-muted-foreground/60 group-hover:text-muted-foreground uppercase tracking-wider">{field}</span>
                  <span className="text-sm font-mono truncate max-w-[140px]">{model}</span>
                </button>
                {pickerOpen === field && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setPickerOpen(null)}
                    />
                    <div className="absolute top-full left-0 mt-2 z-50 bg-popover border border-border rounded-lg shadow-2xl p-4 w-[480px] animate-in fade-in slide-in-from-top-2 duration-200">
                      <ModelPicker
                        id={`header-${field}-model`}
                        label={`${label} Model`}
                        value={model}
                        onChange={value => {
                          saveModel(field, value)
                        }}
                      />
                    </div>
                  </>
                )}
              </div>
            )
          })}
          <ThemePicker />
          <DarkModeToggle />
          <button onClick={() => setShowSettings(s => !s)} title="Settings" className="flex items-center justify-center px-4 border-l border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <Settings size={16} />
          </button>
          <div
            title={sseConnected ? 'Live updates connected' : 'Live updates disconnected'}
            className={`flex items-center justify-center px-3 border-l border-border`}
          >
            <span className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]' : 'bg-muted-foreground/40'}`} />
          </div>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        {sidebarCollapsed ? (
          <div className="relative shrink-0 border-r w-0 bg-muted">
            <button
              onClick={() => setSidebarCollapsed(false)}
              title="Expand sidebar"
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-20 flex items-center justify-center w-5 h-8 rounded-full border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-sm"
            >
              <ChevronRight size={12} />
            </button>
          </div>
        ) : (
          <>
            {/* Outer wrapper: positioning context for the toggle button, no overflow */}
            <div className="relative shrink-0" style={{ width: leftWidthPx }}>
              {/* Inner div: scroll container, separate from button positioning */}
              <div className="flex flex-col overflow-y-auto h-full border-r bg-muted w-full">
                <ResumeBanner sessions={interruptedSessions} onSelect={handleSelect} />
                <ImplList
                  entries={entries}
                  selectedSlug={selectedSlug}
                  onSelect={handleSelect}
                  onDelete={handleDelete}
                  loading={loading}
                  repos={repos}
                  onManageRepos={() => setShowSettings(true)}
                  onRemoveRepo={(name) => void handleRemoveRepo(name)}
                />
              </div>
              <button
                onClick={() => setSidebarCollapsed(true)}
                title="Collapse sidebar"
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-20 flex items-center justify-center w-5 h-8 rounded-full border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-sm"
              >
                <ChevronLeft size={12} />
              </button>
            </div>
            <div {...dividerProps} />
          </>
        )}

        {/* Center column */}
        <div className="flex-1 overflow-y-auto min-w-0">
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
          )}
        </div>

        {/* Right divider + rail — only when liveView is not null */}
        {liveView !== null && (
          <div
            onMouseDown={rightDividerMouseDown}
            style={{ width: '4px', flexShrink: 0, alignSelf: 'stretch' }}
            className="cursor-col-resize select-none bg-border hover:bg-primary/30 transition-colors"
          />
        )}
        {liveView !== null && (
          <div className="shrink-0 overflow-hidden border-l" style={{ width: rightWidthPx }}>
            <LiveRail
              slug={selectedSlug}
              liveView={liveView}
              widthPx={rightWidthPx}
              onScoutComplete={handleScoutComplete}
              onScoutReady={handleScoutReady}
              onClose={() => setLiveView(null)}
              repos={repos}
              activeRepo={activeRepo}
              onRepoSwitch={handleRepoSwitch}
            />
          </div>
        )}
      </div>
    </div>

    {showSettings && createPortal(
      <>
        {/* Backdrop */}
        <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setShowSettings(false)} />
        {/* Drawer */}
        <div className="fixed inset-y-0 right-0 z-50 w-[560px] max-w-[90vw] bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700 shadow-2xl overflow-y-auto">
          <SettingsScreen
          onClose={() => {
            setShowSettings(false)
            getConfig().then(config => {
              setScoutModel(config.agent?.scout_model ?? '')
              setScaffoldModel(config.agent?.scaffold_model ?? '')
              setWaveModel(config.agent?.wave_model ?? '')
              setIntegrationModel(config.agent?.integration_model ?? '')
              setChatModel(config.agent?.chat_model ?? '')
            }).catch(() => {})
          }}
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
    </>
  )
}
