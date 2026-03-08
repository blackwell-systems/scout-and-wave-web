import { useState, useEffect } from 'react'
import { listImpls, fetchImpl, approveImpl, rejectImpl, startWave, deleteImpl } from './api'
import { IMPLDocResponse, IMPLListEntry } from './types'
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

  const { leftWidthPx, dividerProps } = useResizableDivider({ initialWidthPx: 220, minWidthPx: 140, maxFraction: 0.10 })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const [rightWidthPx, setRightWidthPx] = useState(380)
  const rightDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const onMove = (mv: MouseEvent) => {
      setRightWidthPx(Math.max(280, Math.min(window.innerWidth - mv.clientX, window.innerWidth * 0.55)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    listImpls().then(setEntries).catch(() => {})
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
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tracking-tight">Scout and Wave</span>
          <button
            onClick={() => setLiveView('scout')}
            className="text-xs px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
          >
            New plan
          </button>
        </div>
        <div className="flex items-center gap-2">
          <ThemePicker />
          <DarkModeToggle />
          <button onClick={() => setShowSettings(true)} title="Settings" className="p-1 hover:opacity-70">
            <Settings size={16} />
          </button>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        {sidebarCollapsed ? (
          <div
            className="flex flex-col items-center shrink-0 border-r w-9 bg-background dark:bg-[#191919] cursor-pointer"
            onDoubleClick={() => setSidebarCollapsed(false)}
            title="Double-click to expand"
          >
            <button
              onClick={() => setSidebarCollapsed(false)}
              title="Expand sidebar"
              className="mt-2 p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col overflow-y-auto shrink-0 border-r relative dark:bg-[#191919]" style={{ width: leftWidthPx }}>
              <button
                onClick={() => setSidebarCollapsed(true)}
                title="Collapse sidebar"
                className="absolute top-2 right-2 z-10 p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft size={14} />
              </button>
              <ImplList
                entries={entries}
                selectedSlug={selectedSlug}
                onSelect={handleSelect}
                onDelete={handleDelete}
                loading={loading}
              />
            </div>
            <div {...dividerProps} />
          </>
        )}

        {/* Center column */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {showSettings ? (
            <SettingsScreen onClose={() => setShowSettings(false)} />
          ) : (
            <>
              {error && <p className="text-destructive text-sm p-4">{error}</p>}
              {loading && <p className="text-muted-foreground text-sm p-4">Loading...</p>}
              {rejected && <p className="text-orange-600 text-sm p-4">Plan rejected.</p>}
              {!loading && impl !== null && selectedSlug !== null && (
                <ReviewScreen slug={selectedSlug} impl={impl} onApprove={handleApprove} onReject={handleReject} onRefreshImpl={handleSelect} />
              )}
              {!loading && impl === null && !error && (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Select a plan from the list to review.
                </div>
              )}
            </>
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
            />
          </div>
        )}
      </div>
    </div>
  )
}
