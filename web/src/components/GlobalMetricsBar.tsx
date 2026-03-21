import { PipelineMetrics } from '../types/autonomy'

interface GlobalMetricsBarProps {
  metrics: PipelineMetrics
}

/**
 * Horizontal metrics bar showing pipeline throughput stats.
 * Designed to sit at the top of the unified programs view.
 * Ported from PipelineMetricsBar display logic.
 */
export default function GlobalMetricsBar({ metrics }: GlobalMetricsBarProps): JSX.Element {
  return (
    <div className="flex items-center justify-between px-6 py-2.5 bg-muted/40 border-b border-border text-sm">
      <div className="flex gap-6">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">IMPLs/hr:</span>
          <span className="font-mono font-semibold text-foreground">
            {metrics.impls_per_hour.toFixed(1)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Avg Wave:</span>
          <span className="font-mono font-semibold text-foreground">
            {metrics.avg_wave_seconds}s
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Queue:</span>
          <span className="font-mono font-semibold text-foreground">
            {metrics.queue_depth}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Blocked:</span>
          <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
            {metrics.blocked_count}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Completed:</span>
          <span className="font-mono font-semibold text-green-600 dark:text-green-400">
            {metrics.completed_count}
          </span>
        </div>
      </div>
    </div>
  )
}
