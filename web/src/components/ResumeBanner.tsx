import { InterruptedSession } from '../types'

interface ResumeBannerProps {
  sessions: InterruptedSession[]
  onSelect: (slug: string) => void
}

export default function ResumeBanner({ sessions, onSelect }: ResumeBannerProps): JSX.Element | null {
  if (sessions.length === 0) return null

  return (
    <div className="mx-2 mt-2 mb-1 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        Interrupted {sessions.length === 1 ? 'session' : 'sessions'}
      </div>
      {sessions.map((s) => (
        <button
          key={s.impl_slug}
          onClick={() => onSelect(s.impl_slug)}
          className="w-full text-left rounded px-2 py-1.5 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-foreground truncate">{s.impl_slug}</span>
            <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
              {Math.round(s.progress_pct)}%
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
            Wave {s.current_wave}/{s.total_waves}
            {s.failed_agents.length > 0 && (
              <span className="text-destructive ml-1">
                — {s.failed_agents.length} failed
              </span>
            )}
            {s.orphaned_worktrees.length > 0 && (
              <span className="text-amber-600 dark:text-amber-400 ml-1">
                — {s.orphaned_worktrees.length} orphaned worktree{s.orphaned_worktrees.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground/70 mt-0.5 italic group-hover:text-foreground transition-colors">
            {s.suggested_action}
          </div>
        </button>
      ))}
    </div>
  )
}
