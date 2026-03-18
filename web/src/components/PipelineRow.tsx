import { CheckCircle, Loader2, PauseCircle, Clock } from 'lucide-react'
import { PipelineEntry } from '../types/autonomy'

interface PipelineRowProps {
  entry: PipelineEntry
  onSelect: (slug: string) => void
}

const hoverColors: Record<string, string> = {
  executing: 'hover:bg-blue-50 dark:hover:bg-blue-950/30',
  complete: 'hover:bg-green-50 dark:hover:bg-green-950/30',
  blocked: 'hover:bg-amber-50 dark:hover:bg-amber-950/30',
  queued: 'hover:bg-muted/50',
}

export default function PipelineRow({ entry, onSelect }: PipelineRowProps): JSX.Element {
  const statusIcon = () => {
    switch (entry.status) {
      case 'complete':
        return <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
      case 'executing':
        return <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
      case 'blocked':
        return <PauseCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
      case 'queued':
        return <Clock className="w-5 h-5 text-muted-foreground" />
    }
  }

  const statusDetail = () => {
    if (entry.status === 'executing' && entry.wave_progress) {
      return (
        <span className="text-sm text-muted-foreground">
          {entry.wave_progress}
          {entry.active_agent && ` · ${entry.active_agent}`}
        </span>
      )
    }
    if (entry.status === 'blocked' && entry.blocked_reason) {
      return (
        <span className="text-sm text-amber-600 dark:text-amber-400">
          {entry.blocked_reason}
        </span>
      )
    }
    if (entry.status === 'queued' && entry.queue_position !== undefined) {
      return (
        <span className="text-sm text-muted-foreground">
          Position #{entry.queue_position}
        </span>
      )
    }
    if (entry.status === 'complete' && entry.completed_at) {
      const elapsed = entry.elapsed_seconds
        ? `${Math.floor(entry.elapsed_seconds / 60)}m ${entry.elapsed_seconds % 60}s`
        : ''
      return (
        <span className="text-sm text-muted-foreground">
          {new Date(entry.completed_at).toLocaleTimeString()}
          {elapsed && ` · ${elapsed}`}
        </span>
      )
    }
    return null
  }

  const actionButton = () => {
    if (entry.status === 'executing') {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(entry.slug) }}
          className="px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 active:scale-95 transition-all"
        >
          Live
        </button>
      )
    }
    if (entry.status === 'complete') {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(entry.slug) }}
          className="px-4 py-2 text-sm font-medium text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 rounded hover:bg-green-200 dark:hover:bg-green-900/50 active:scale-95 transition-all"
        >
          Review
        </button>
      )
    }
    if (entry.status === 'blocked') {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(entry.slug) }}
          className="px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 active:scale-95 transition-all"
        >
          View
        </button>
      )
    }
    if (entry.status === 'queued') {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(entry.slug) }}
          className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted rounded hover:bg-muted/80 active:scale-95 transition-all"
        >
          View
        </button>
      )
    }
    return null
  }

  return (
    <div
      className={`flex items-center gap-4 px-6 py-4 border-b border-border ${hoverColors[entry.status] ?? 'hover:bg-muted/50'} transition-all duration-150 cursor-pointer`}
      onClick={() => onSelect(entry.slug)}
    >
      <div className="flex-shrink-0">
        {statusIcon()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-foreground truncate">
          {entry.title}
        </div>
        <div className="flex items-center gap-2 mt-1">
          {entry.repo && (
            <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {entry.repo}
            </span>
          )}
          {statusDetail()}
        </div>
      </div>
      <div className="flex-shrink-0">
        {actionButton()}
      </div>
    </div>
  )
}
