import { useState } from 'react'
import { X } from 'lucide-react'
import { usePipeline } from '../hooks/usePipeline'
import PipelineRow from './PipelineRow'
import PipelineMetricsBar from './PipelineMetrics'
import QueuePanel from './QueuePanel'
import DaemonControl from './DaemonControl'
import AutonomySettings from './AutonomySettings'

interface PipelineViewProps {
  onSelectImpl: (slug: string) => void
  onClose: () => void
}

/**
 * Top-level page showing all IMPLs across the pipeline lifecycle.
 * Fetches from GET /api/pipeline and subscribes to SSE pipeline_updated events.
 * Created by Agent D (wave 2).
 */
type SideTab = 'queue' | 'daemon' | 'settings'

export default function PipelineView({ onSelectImpl, onClose }: PipelineViewProps): JSX.Element {
  const { entries, metrics, autonomyLevel, loading, error } = usePipeline()
  const [sideTab, setSideTab] = useState<SideTab>('queue')

  const autonomyColors = {
    gated: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    supervised: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    autonomous: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  }

  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading pipeline...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-destructive">Error loading pipeline: {error}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-foreground">SAW Pipeline</h1>
          <span className={`px-3 py-1 text-xs font-semibold uppercase rounded ${autonomyColors[autonomyLevel]}`}>
            {autonomyLevel}
          </span>
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold">{metrics.impls_per_hour.toFixed(1)}</span> IMPLs/hr
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Two-column body */}
      <div className="flex flex-1 min-h-0">
        {/* Left: pipeline entries */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto">
            {entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                <p>No active IMPLs in pipeline</p>
                {metrics.completed_count > 0 && (
                  <p className="text-xs">{metrics.completed_count} completed IMPL{metrics.completed_count !== 1 ? 's' : ''} archived</p>
                )}
              </div>
            ) : (
              entries.map((entry) => (
                <PipelineRow key={entry.slug} entry={entry} onSelect={onSelectImpl} />
              ))
            )}
          </div>
          <PipelineMetricsBar metrics={metrics} />
        </div>

        {/* Right: control sidebar */}
        <div className="w-[320px] shrink-0 border-l border-border flex flex-col">
          {/* Tabs */}
          <div className="flex border-b border-border">
            {([['queue', 'Queue'], ['daemon', 'Daemon'], ['settings', 'Settings']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSideTab(key)}
                className={`flex-1 text-xs font-medium py-2.5 transition-colors ${
                  sideTab === key
                    ? 'text-foreground border-b-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {sideTab === 'queue' && <QueuePanel onSelectItem={onSelectImpl} />}
            {sideTab === 'daemon' && <DaemonControl />}
            {sideTab === 'settings' && <AutonomySettings />}
          </div>
        </div>
      </div>
    </div>
  )
}
