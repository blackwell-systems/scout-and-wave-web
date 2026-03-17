import { Play, Square, Loader2 } from 'lucide-react'
import { Button } from './ui/button'
import { useDaemon, DaemonEvent } from '../hooks/useDaemon'

export default function DaemonControl(): JSX.Element {
  const { state, events, start, stop, loading, error } = useDaemon()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        Loading daemon status...
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Daemon Control</h3>
        <Button
          onClick={state.running ? stop : start}
          size="sm"
          variant={state.running ? 'destructive' : 'default'}
        >
          {state.running ? (
            <>
              <Square size={14} />
              Stop
            </>
          ) : (
            <>
              <Play size={14} />
              Start
            </>
          )}
        </Button>
      </div>

      {error && (
        <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
          {error}
        </div>
      )}

      {/* Status display */}
      <div className="rounded-lg border border-border bg-card p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            {state.running ? (
              <>
                <Loader2 size={14} className="animate-spin text-green-500" />
                <span className="text-xs font-medium text-green-600 dark:text-green-400">Running</span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-zinc-400" />
                <span className="text-xs font-medium text-muted-foreground">Stopped</span>
              </>
            )}
          </div>
        </div>

        {state.running && (
          <div className="text-xs text-muted-foreground space-y-1">
            {state.current_impl && (
              <div>Current IMPL: <span className="font-mono">{state.current_impl}</span></div>
            )}
            {state.current_wave !== undefined && (
              <div>Current Wave: {state.current_wave}</div>
            )}
          </div>
        )}

        <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
          <div>Queue depth: {state.queue_depth}</div>
          <div>Completed: {state.completed_count}</div>
          <div>Blocked: {state.blocked_count}</div>
        </div>
      </div>

      {/* Event log */}
      {events.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3 flex flex-col gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">Recent Events</h4>
          <div className="max-h-48 overflow-y-auto space-y-1.5">
            {events.slice(-20).reverse().map((evt, idx) => (
              <div key={idx} className="text-xs font-mono border-b border-border pb-1.5 last:border-0">
                <span className="text-muted-foreground">[{evt.type}]</span> {evt.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
