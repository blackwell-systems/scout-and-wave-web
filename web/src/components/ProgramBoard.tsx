import { useState, useEffect, useCallback } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import ProgressBar from './ProgressBar'
import { fetchProgramStatus, executeTier, replanProgram, listProgramsFull, analyzeImpls, createProgramFromImpls } from '../programApi'
import type { ProgramStatus, TierStatus, ImplTierStatus, ProgramDiscovery, ProgramListResponse, ConflictReport } from '../types/program'
// PipelineEntry used by PipelineRow (imported transitively)
// GlobalMetricsBar removed — using PipelineMetricsBar at bottom instead
import OperationsPanel from './OperationsPanel'
import PipelineRow from './PipelineRow'
import PipelineMetricsBar from './PipelineMetrics'
import { useGlobalEvents } from '../hooks/useGlobalEvents'
import { ChevronDown, List, GitBranch } from 'lucide-react'
import { getRepoColor, getRepoColorWithOpacity } from '../lib/entityColors'
import ProgramDependencyGraph from './ProgramDependencyGraph'
import CreateFromImplsPanel from './CreateFromImplsPanel'
import DisjointAnalysisScreen from './DisjointAnalysisScreen'

interface ProgramBoardProps {
  programSlug: string
  onSelectImpl?: (implSlug: string) => void
}

function getImplStatusColor(status: string): string {
  switch (status) {
    case 'complete':      return 'rgb(63, 185, 80)'
    case 'executing':
    case 'in-progress':   return 'rgb(88, 166, 255)'
    case 'reviewed':      return 'rgb(210, 153, 34)'
    case 'scouting':      return 'rgb(130, 100, 220)'
    case 'blocked':
    case 'not-suitable':  return 'rgb(248, 81, 73)'
    default:              return 'rgba(140, 140, 150, 0.4)'
  }
}

function getImplStatusBadge(status: string): JSX.Element {
  switch (status) {
    case 'complete':
      return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800">Complete</span>
    case 'executing':
    case 'in-progress':
      return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 animate-pulse">Executing</span>
    case 'reviewed':
      return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800">Reviewed</span>
    case 'scouting':
      return <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800 animate-pulse">Scouting</span>
    case 'blocked':
      return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">Blocked</span>
    case 'not-suitable':
      return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">Not Suitable</span>
    default:
      return <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">Pending</span>
  }
}

function ImplCard({
  impl,
  onClick,
  waveProgress,
}: {
  impl: ImplTierStatus
  onClick?: () => void
  waveProgress?: string
}): JSX.Element {
  const borderColor = getImplStatusColor(impl.status)
  const clickable = onClick !== undefined
  // Prefer SSE-updated waveProgress over impl.wave_progress (SSE is more current)
  const progressLabel = waveProgress ?? impl.wave_progress

  return (
    <div
      onClick={onClick}
      className={`flex flex-col gap-2 p-3 rounded-lg border-2 transition-all ${
        clickable ? 'cursor-pointer hover:scale-105 hover:shadow-lg' : ''
      }`}
      style={{
        borderColor,
        boxShadow: impl.status === 'running' ? `0 0 12px ${borderColor}40` : undefined,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground truncate">{impl.slug}</span>
        {getImplStatusBadge(impl.status)}
      </div>
      {(impl.status === 'executing' || impl.status === 'in-progress' || impl.status === 'scouting') && (
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full animate-pulse"
              style={{ width: '50%' }}
            />
          </div>
          {progressLabel && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">{progressLabel}</span>
          )}
        </div>
      )}
    </div>
  )
}

function TierSection({
  tier,
  isActive,
  isBlocked,
  onExecuteTier,
  onSelectImpl,
  waveProgress,
}: {
  tier: TierStatus
  isActive: boolean
  isBlocked: boolean
  onExecuteTier?: () => void
  onSelectImpl?: (implSlug: string) => void
  waveProgress?: Record<string, string>
}): JSX.Element {
  const [executing, setExecuting] = useState(false)

  const handleExecute = async () => {
    if (!onExecuteTier) return
    setExecuting(true)
    try {
      await onExecuteTier()
    } finally {
      setExecuting(false)
    }
  }

  return (
    <Card className="border-2">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg">Tier {tier.number}</CardTitle>
            {isBlocked && (
              <span className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-700 flex items-center gap-1">
                <span>🔒</span>
                <span>Blocked on Tier {tier.number - 1}</span>
              </span>
            )}
            {tier.complete && (
              <span className="text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800">
                ✓ Complete
              </span>
            )}
          </div>
          {isActive && !tier.complete && onExecuteTier && (
            <button
              onClick={handleExecute}
              disabled={executing}
              className="text-sm font-medium px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {executing ? 'Executing...' : 'Execute Tier'}
            </button>
          )}
        </div>
        {tier.description && (
          <p className="text-sm text-muted-foreground mt-2">{tier.description}</p>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {tier.impl_statuses.map((impl) => (
            <ImplCard
              key={impl.slug}
              impl={impl}
              onClick={onSelectImpl ? () => onSelectImpl(impl.slug) : undefined}
              waveProgress={waveProgress?.[impl.slug]}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// --- Unified Programs View ---

export interface UnifiedProgramsViewProps {
  onSelectImpl: (slug: string) => void
  onSelectProgram: (programSlug: string) => void
  createFromImplsOpen?: boolean
}

export function UnifiedProgramsView({ onSelectImpl, onSelectProgram, createFromImplsOpen }: UnifiedProgramsViewProps): JSX.Element {
  const [data, setData] = useState<ProgramListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedProgram, setSelectedProgram] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const [programSelection, setProgramSelection] = useState<Set<string>>(new Set())
  const [repoFilters, setRepoFilters] = useState<Set<string>>(new Set())

  // Create-from-IMPLs flow state
  const [createFromImplsMode, setCreateFromImplsMode] = useState<'hidden' | 'select' | 'analyze'>('hidden')
  const [selectedImplSlugs, setSelectedImplSlugs] = useState<string[]>([])
  const [conflictReport, setConflictReport] = useState<ConflictReport | null>(null)

  // React to external trigger from App.tsx
  useEffect(() => {
    if (createFromImplsOpen) {
      setCreateFromImplsMode('select')
    }
  }, [createFromImplsOpen])

  const loadData = useCallback(async () => {
    try {
      const resp = await listProgramsFull()
      setData(resp)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Subscribe to SSE events for live updates
  const handleRefresh = useCallback(() => {
    void loadData()
  }, [loadData])

  useGlobalEvents({
    program_list_updated: handleRefresh,
    pipeline_updated: handleRefresh,
  })

  const handleSelectProgram = (slug: string) => {
    setSelectedProgram(slug)
    onSelectProgram(slug)
  }

  // If a program is selected, show its detail board
  if (selectedProgram) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-y-auto">
              <div className="px-4 pt-3 pb-1">
                <button
                  onClick={() => setSelectedProgram(null)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  &larr; Back to all programs
                </button>
              </div>
              <ProgramBoard
                programSlug={selectedProgram}
                onSelectImpl={onSelectImpl}
              />
            </div>
            {data?.metrics && <PipelineMetricsBar metrics={data.metrics} />}
          </div>
          <OperationsPanel onSelectItem={onSelectImpl} />
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading programs...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-destructive">Error: {error}</div>
      </div>
    )
  }

  const programs = data?.programs ?? []
  const metrics = data?.metrics
  const standalone = data?.standalone ?? []

  // Split standalone into active vs completed
  const activeEntries = standalone.filter((e) => e.status !== 'complete')
  const completedEntries = standalone.filter((e) => e.status === 'complete')

  // Create-from-IMPLs: selection panel
  if (createFromImplsMode === 'select') {
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-y-auto p-6">
              <CreateFromImplsPanel
                standalone={standalone}
                onAnalyze={async (slugs) => {
                  setSelectedImplSlugs(slugs)
                  try {
                    const report = await analyzeImpls(slugs)
                    setConflictReport(report)
                    setCreateFromImplsMode('analyze')
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err))
                  }
                }}
                onClose={() => setCreateFromImplsMode('hidden')}
              />
            </div>
            {metrics && <PipelineMetricsBar metrics={metrics} />}
          </div>
          <OperationsPanel onSelectItem={onSelectImpl} />
        </div>
      </div>
    )
  }

  // Create-from-IMPLs: analysis/confirm screen
  if (createFromImplsMode === 'analyze' && conflictReport) {
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-y-auto p-6">
              <DisjointAnalysisScreen
                slugs={selectedImplSlugs}
                conflictReport={conflictReport}
                onConfirm={async (name, programSlug) => {
                  try {
                    const result = await createProgramFromImpls(selectedImplSlugs, name, programSlug)
                    setCreateFromImplsMode('hidden')
                    setSelectedImplSlugs([])
                    setConflictReport(null)
                    await loadData()
                    // Navigate to the newly created program
                    if (result.manifest?.slug) {
                      handleSelectProgram(result.manifest.slug)
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err))
                  }
                }}
                onBack={() => setCreateFromImplsMode('select')}
              />
            </div>
            {metrics && <PipelineMetricsBar metrics={metrics} />}
          </div>
          <OperationsPanel onSelectItem={onSelectImpl} />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Two-column body */}
      <div className="flex flex-1 min-h-0">
        {/* Left: main content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto">
            {/* Programs section */}
            {programs.length > 0 && (
              <div className="px-6 pt-5 pb-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Programs</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {programs.map((p) => (
                    <ProgramCard key={p.slug} program={p} onClick={() => handleSelectProgram(p.slug)} />
                  ))}
                </div>
              </div>
            )}

            {/* Active IMPLs — pipeline row style */}
            {activeEntries.length > 0 && (() => {
              const repos = [...new Set(activeEntries.map(e => e.repo).filter(Boolean))] as string[]
              const filtered = repoFilters.size > 0 ? activeEntries.filter(e => e.repo && repoFilters.has(e.repo)) : activeEntries
              const allSelected = repoFilters.size === 0
              return (
              <div>
                <div className="px-6 pt-4 pb-2 flex items-center gap-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Active ({filtered.length})
                  </h2>
                  {repos.length > 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setRepoFilters(prev => prev.size === 0 ? new Set(repos) : new Set())}
                        className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                          allSelected ? 'bg-foreground/10 text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        All
                      </button>
                      {repos.map(repo => {
                        const isActive = repoFilters.has(repo)
                        return (
                          <button
                            key={repo}
                            onClick={() => setRepoFilters(prev => {
                              const next = new Set(prev)
                              if (next.has(repo)) {
                                next.delete(repo)
                                // If nothing left, go back to "all"
                                if (next.size === 0) return new Set()
                              } else {
                                next.add(repo)
                                // If all selected, clear to "all" mode
                                if (next.size === repos.length) return new Set()
                              }
                              return next
                            })}
                            className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                              isActive ? 'font-medium' : 'hover:opacity-80'
                            }`}
                            style={{
                              color: getRepoColor(repo),
                              backgroundColor: isActive ? getRepoColorWithOpacity(repo, 0.2) : 'transparent',
                            }}
                          >
                            {repo}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                {filtered.map((entry) => (
                  <PipelineRow
                    key={entry.slug}
                    entry={entry}
                    onSelect={onSelectImpl}
                    onSelectProgram={handleSelectProgram}
                    onToggleProgramSelect={(slug) => {
                      setProgramSelection(prev => {
                        const next = new Set(prev)
                        if (next.has(slug)) next.delete(slug)
                        else next.add(slug)
                        return next
                      })
                    }}
                    isProgramSelected={programSelection.has(entry.slug)}
                  />
                ))}
              </div>
              )})()}

            {activeEntries.length === 0 && programs.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
                <p>No active IMPLs in pipeline</p>
                {completedEntries.length > 0 && (
                  <p className="text-xs">{completedEntries.length} completed IMPL{completedEntries.length !== 1 ? 's' : ''} archived</p>
                )}
              </div>
            )}

            {/* Completed IMPLs — collapsed by default */}
            {completedEntries.length > 0 && (
              <div>
                <button
                  onClick={() => setShowCompleted((prev) => !prev)}
                  className="flex items-center gap-2 px-6 pt-4 pb-2 w-full text-left group"
                >
                  <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ${showCompleted ? '' : '-rotate-90'}`} />
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
                    Completed ({completedEntries.length})
                  </h2>
                </button>
                {showCompleted && completedEntries.map((entry) => (
                  <PipelineRow
                    key={entry.slug}
                    entry={entry}
                    onSelect={onSelectImpl}
                    onSelectProgram={handleSelectProgram}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Program selection action bar */}
          {programSelection.size >= 2 && (
            <div className="flex items-center justify-between px-6 py-3 bg-violet-50 dark:bg-violet-950/40 border-t border-violet-200 dark:border-violet-800">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-violet-800 dark:text-violet-300">
                  {programSelection.size} IMPLs selected
                </span>
                <button
                  onClick={() => setProgramSelection(new Set())}
                  className="text-xs text-violet-600 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-200 transition-colors"
                >
                  Clear
                </button>
              </div>
              <button
                onClick={async () => {
                  const slugs = Array.from(programSelection)
                  setSelectedImplSlugs(slugs)
                  try {
                    const report = await analyzeImpls(slugs)
                    setConflictReport(report)
                    setCreateFromImplsMode('analyze')
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err))
                  }
                }}
                className="text-sm font-medium px-4 py-2 rounded border border-violet-400 dark:border-violet-600 text-violet-800 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
              >
                Perform Disjoint Analysis
              </button>
            </div>
          )}

          {/* Single selection hint */}
          {programSelection.size === 1 && (
            <div className="flex items-center justify-between px-6 py-2 bg-muted/40 border-t border-border">
              <span className="text-xs text-muted-foreground">Select at least 2 IMPLs to create a program</span>
              <button
                onClick={() => setProgramSelection(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            </div>
          )}

          {/* Metrics bar at bottom */}
          {metrics && <PipelineMetricsBar metrics={metrics} />}
        </div>

        {/* Right: operations sidebar */}
        <OperationsPanel onSelectItem={onSelectImpl} />
      </div>
    </div>
  )
}

const PROGRAM_STATE_COLORS: Record<string, string> = {
  COMPLETE:       'bg-green-500',
  TIER_EXECUTING: 'bg-blue-500 animate-pulse',
  REVIEWED:       'bg-yellow-400',
  SCAFFOLD:       'bg-purple-400',
  BLOCKED:        'bg-red-500',
}

function ProgramCard({ program, onClick }: { program: ProgramDiscovery; onClick: () => void }): JSX.Element {
  const dotColor = PROGRAM_STATE_COLORS[program.state] ?? 'bg-gray-400'
  return (
    <div
      onClick={onClick}
      className="flex flex-col gap-2 p-4 rounded-lg border border-border bg-card cursor-pointer hover:shadow-md hover:border-primary/40 transition-all"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground truncate">{program.title || program.slug}</span>
        <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
      </div>
      <span className="text-xs text-muted-foreground">{program.state}</span>
    </div>
  )
}

// --- Original ProgramBoard (single-program detail view) ---

export default function ProgramBoard({ programSlug, onSelectImpl }: ProgramBoardProps): JSX.Element {
  const [status, setStatus] = useState<ProgramStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [waveProgress, setWaveProgress] = useState<Record<string, string>>({})
  const [replanning, setReplanning] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list')

  useEffect(() => {
    // Reset wave progress and view mode when programSlug changes
    setWaveProgress({})
    setViewMode('list')

    // Initial fetch
    const loadStatus = async () => {
      try {
        const data = await fetchProgramStatus(programSlug)
        setStatus(data)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }
    void loadStatus()

    // SSE reconnection with exponential backoff
    let retryDelay = 1000  // ms, start at 1s
    const maxRetryDelay = 30000  // cap at 30s
    let retryTimeout: ReturnType<typeof setTimeout> | null = null
    let currentEventSource: EventSource | null = null

    const handleEvent = (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      if (data.program_slug === programSlug) {
        // Refetch status on any program event
        void loadStatus()
      }
    }

    const handleWaveProgress = (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      if (data.program_slug === programSlug && data.impl_slug && data.total_waves > 0) {
        setWaveProgress(prev => ({
          ...prev,
          [data.impl_slug]: `Wave ${data.current_wave}/${data.total_waves}`
        }))
      }
    }

    const connect = () => {
      if (currentEventSource) {
        currentEventSource.close()
      }
      const es = new EventSource('/api/program/events')
      currentEventSource = es

      es.addEventListener('program_tier_started', handleEvent)
      es.addEventListener('program_tier_complete', handleEvent)
      es.addEventListener('program_impl_started', handleEvent)
      es.addEventListener('program_impl_complete', handleEvent)
      es.addEventListener('program_complete', handleEvent)
      es.addEventListener('program_blocked', handleEvent)
      // Listen for wave progress events (U3)
      es.addEventListener('program_impl_wave_progress', handleWaveProgress)
      // Listen for replan completion/failure (E34)
      es.addEventListener('program_replan_complete', (e: MessageEvent) => {
        const data = JSON.parse(e.data)
        if (data.program_slug === programSlug) {
          setReplanning(false)
          void loadStatus()
        }
      })
      es.addEventListener('program_replan_failed', (e: MessageEvent) => {
        const data = JSON.parse(e.data)
        if (data.program_slug === programSlug) {
          setReplanning(false)
          void loadStatus()
        }
      })

      es.onopen = () => {
        setConnected(true)
        retryDelay = 1000  // reset on successful connection
      }
      es.onerror = () => {
        setConnected(false)
        es.close()
        retryTimeout = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, maxRetryDelay)
          connect()
        }, retryDelay)
      }
    }

    connect()

    return () => {
      if (retryTimeout) clearTimeout(retryTimeout)
      if (currentEventSource) currentEventSource.close()
    }
  }, [programSlug])

  const handleReplan = async () => {
    setReplanning(true)
    try {
      await replanProgram(programSlug)
    } catch (err) {
      console.error('Failed to trigger replan:', err)
      setReplanning(false)
    }
  }

  const handleExecuteTier = async (tierNumber: number) => {
    try {
      await executeTier(programSlug, tierNumber, false)
    } catch (err) {
      console.error('Failed to execute tier:', err)
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading program...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-destructive">Error loading program: {error}</div>
      </div>
    )
  }

  if (!status) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-muted-foreground">No program data</div>
      </div>
    )
  }

  const completion = status.completion

  return (
    <div className="h-full overflow-y-auto bg-background p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{status.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Tier {status.current_tier} active • {completion.impls_complete}/{completion.impls_total} IMPLs complete
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* View mode toggle */}
            <div className="flex rounded-lg overflow-hidden border border-border">
              <button
                onClick={() => setViewMode('list')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === 'list'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                List
              </button>
              <button
                onClick={() => setViewMode('graph')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === 'graph'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5" />
                Graph
              </button>
            </div>
            {(status.state === 'BLOCKED' || status.state === 'blocked') && (
              <button
                onClick={() => void handleReplan()}
                disabled={replanning}
                className="text-sm font-medium px-4 py-2 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {replanning ? 'Replanning...' : 'Replan'}
              </button>
            )}
            {!connected && (
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full animate-pulse">
                Reconnecting...
              </span>
            )}
            <div className="text-right">
              <div className="text-sm font-semibold text-foreground">
                {completion.impls_complete}/{completion.impls_total} IMPLs
              </div>
              <div className="text-xs text-muted-foreground">
                {completion.total_agents} agents • {completion.total_waves} waves
              </div>
            </div>
          </div>
        </div>

        {/* Overall progress */}
        <Card>
          <CardContent className="pt-6">
            <ProgressBar
              complete={completion.tiers_complete}
              total={completion.tiers_total}
              label="Program Progress"
            />
          </CardContent>
        </Card>

        {/* Program complete banner */}
        {status.state === 'complete' && (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center bg-card border border-border rounded-lg">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center mb-4">
              <span className="text-green-600 dark:text-green-400 text-3xl">✓</span>
            </div>
            <h2 className="text-xl font-semibold text-green-800 dark:text-green-300 mb-2">
              Program Complete
            </h2>
            <p className="text-sm text-muted-foreground">
              All {completion.impls_total} IMPLs successfully implemented and verified
            </p>
          </div>
        )}

        {/* Tier sections / Graph view */}
        {viewMode === 'list' ? (
          <div className="space-y-6">
            {status.tier_statuses.map((tier) => {
              const isActive = tier.number === status.current_tier
              const isBlocked = tier.number > status.current_tier && !status.tier_statuses[tier.number - 2]?.complete
              return (
                <TierSection
                  key={tier.number}
                  tier={tier}
                  isActive={isActive}
                  isBlocked={isBlocked}
                  onExecuteTier={isActive && !tier.complete ? () => handleExecuteTier(tier.number) : undefined}
                  onSelectImpl={onSelectImpl}
                  waveProgress={waveProgress}
                />
              )
            })}
          </div>
        ) : (
          <ProgramDependencyGraph
            programSlug={programSlug}
            status={status}
            onSelectImpl={onSelectImpl}
            waveProgress={waveProgress}
          />
        )}

        {/* Executing banner */}
        {status.is_executing && (
          <div className="fixed bottom-4 right-4 bg-blue-500/10 border-2 border-blue-500/30 rounded-lg px-4 py-3 text-blue-700 dark:text-blue-300 text-sm flex items-center gap-2 shadow-lg animate-pulse">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
            <span>Program executing...</span>
          </div>
        )}
      </div>
    </div>
  )
}
