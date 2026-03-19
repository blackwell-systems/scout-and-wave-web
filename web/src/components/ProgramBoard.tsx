import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import ProgressBar from './ProgressBar'
import { fetchProgramStatus, executeTier } from '../programApi'
import type { ProgramStatus, TierStatus, ImplTierStatus } from '../types/program'

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

export default function ProgramBoard({ programSlug, onSelectImpl }: ProgramBoardProps): JSX.Element {
  const [status, setStatus] = useState<ProgramStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [waveProgress, setWaveProgress] = useState<Record<string, string>>({})

  useEffect(() => {
    // Reset wave progress when programSlug changes
    setWaveProgress({})

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

        {/* Tier sections */}
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
