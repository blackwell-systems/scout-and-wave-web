import { X } from 'lucide-react'
import { usePipeline } from '../hooks/usePipeline'
import PipelineRow from './PipelineRow'
import PipelineMetricsBar from './PipelineMetrics'

interface PipelineViewProps {
  onSelectImpl: (slug: string) => void
  onClose: () => void
}

/**
 * Top-level page showing all IMPLs across the pipeline lifecycle.
 * Fetches from GET /api/pipeline and subscribes to SSE pipeline_updated events.
 * Created by Agent D (wave 2).
 */
export default function PipelineView({ onSelectImpl, onClose }: PipelineViewProps): JSX.Element {
  const { entries, metrics, autonomyLevel, loading, error } = usePipeline()

  const autonomyBadge = () => {
    const colors = {
      gated: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      supervised: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      autonomous: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    }
    return (
      <span className={`px-3 py-1 text-xs font-semibold uppercase rounded ${colors[autonomyLevel]}`}>
        {autonomyLevel}
      </span>
    )
  }

  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500 dark:text-gray-400">Loading pipeline...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-600 dark:text-red-400">Error loading pipeline: {error}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-300 dark:border-gray-700">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">SAW Pipeline</h1>
          {autonomyBadge()}
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <span className="font-semibold">{metrics.impls_per_hour.toFixed(1)}</span> IMPLs/hr
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Pipeline entries */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            No IMPLs in pipeline
          </div>
        ) : (
          entries.map((entry) => (
            <PipelineRow key={entry.slug} entry={entry} onSelect={onSelectImpl} />
          ))
        )}
      </div>

      {/* Metrics footer */}
      <PipelineMetricsBar metrics={metrics} />
    </div>
  )
}
