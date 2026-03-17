import { PipelineMetrics } from '../types/autonomy'

interface PipelineMetricsProps {
  metrics: PipelineMetrics
}

/**
 * Bottom bar showing throughput stats for the pipeline.
 * Created by Agent D (wave 2).
 */
export default function PipelineMetricsBar({ metrics }: PipelineMetricsProps): JSX.Element {
  return (
    <div className="flex items-center justify-between px-6 py-3 bg-gray-100 dark:bg-gray-800 border-t border-gray-300 dark:border-gray-700 text-sm">
      <div className="flex gap-6">
        <div className="flex items-center gap-2">
          <span className="text-gray-600 dark:text-gray-400">IMPLs/hr:</span>
          <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
            {metrics.impls_per_hour.toFixed(1)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-600 dark:text-gray-400">Avg Wave:</span>
          <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
            {metrics.avg_wave_seconds}s
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-600 dark:text-gray-400">Queue:</span>
          <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">
            {metrics.queue_depth}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-600 dark:text-gray-400">Blocked:</span>
          <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
            {metrics.blocked_count}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-600 dark:text-gray-400">Completed:</span>
          <span className="font-mono font-semibold text-green-600 dark:text-green-400">
            {metrics.completed_count}
          </span>
        </div>
      </div>
    </div>
  )
}
