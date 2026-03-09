import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { listImpls, fetchImpl, approveImpl, rejectImpl, startWave, deleteImpl, getConfig } from './api'
import { IMPLDocResponse, IMPLListEntry, RepoEntry } from './types'
import ReviewScreen from './components/ReviewScreen'
import DarkModeToggle from './components/DarkModeToggle'
import ImplList from './components/ImplList'
import ThemePicker from './components/ThemePicker'
import LiveRail from './components/LiveRail'
import { LiveView } from './components/LiveRail'
import SettingsScreen from './components/SettingsScreen'
import { useResizableDivider } from './hooks/useResizableDivider'
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react'

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

  function handleReposChange(updated: RepoEntry[]): void {
    setRepos(updated)
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
    es.addEventListener('impl_list_updated', () => {
      listImpls().then(setEntries).catch(() => {})
    })
    return () => es.close()
  }, [])

  useEffect(() => {
    listImpls().then(setEntries).catch(() => {})
    getConfig().then(config => {
      if (config.repos && config.repos.length > 0) {
        setRepos(config.repos)
      } else if (config.repo?.path) {
        setRepos([{ name: 'repo', path: config.repo.path }])
      }
    }).catch(() => {})
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }
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
      try {
        await startWave(selectedSlug!)
      } catch (startErr) {
        // Swallow 409 (already running) and other start errors — still transition to wave screen
        const msg = startErr instanceof Error ? startErr.message : String(startErr)
        if (!msg.includes('409')) {
          console.warn('startWave error (non-fatal):', msg)
        }
      }
      setLiveView('wave')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
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
      <header className="flex items-stretch justify-between h-14 border-b shrink-0">
        <div className="flex items-stretch">
          <button
            onClick={() => setLiveView(v => v === 'scout' ? null : 'scout')}
            className="flex items-center justify-center text-sm font-medium px-6 transition-colors border-r bg-blue-50/60 hover:bg-blue-100/80 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:hover:bg-blue-900/60 dark:text-blue-400 dark:border-blue-800"
          >
            New Plan
          </button>
        </div>
        <div className="flex items-stretch">
          <ThemePicker />
          <DarkModeToggle />
          <button onClick={() => setShowSettings(s => !s)} title="Settings" className="flex items-center justify-center px-4 border-l border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <Settings size={16} />
          </button>
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
            <div className="flex flex-col overflow-y-auto shrink-0 border-r relative bg-muted" style={{ width: leftWidthPx }}>
              <button
                onClick={() => setSidebarCollapsed(true)}
                title="Collapse sidebar"
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-20 flex items-center justify-center w-5 h-8 rounded-full border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-sm"
              >
                <ChevronLeft size={12} />
              </button>
              <ImplList
                entries={entries}
                selectedSlug={selectedSlug}
                onSelect={handleSelect}
                onDelete={handleDelete}
                loading={loading}
                repos={repos}
              />
            </div>
            <div {...dividerProps} />
          </>
        )}

        {/* Center column */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {error && <p className="text-destructive text-sm p-4">{error}</p>}
          {loading && <p className="text-muted-foreground text-sm p-4">Loading...</p>}
          {rejected && <p className="text-orange-600 text-sm p-4">Plan rejected.</p>}
          {!loading && impl !== null && selectedSlug !== null && (
            <ReviewScreen slug={selectedSlug} impl={impl} onApprove={handleApprove} onReject={handleReject} onRefreshImpl={handleSelect} repos={repos} />
          )}
          {!loading && impl === null && !error && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select a plan from the list to review.
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
          <SettingsScreen onClose={() => setShowSettings(false)} onReposChange={handleReposChange} />
        </div>
      </>,
      document.body
    )}
    </>
  )
}
