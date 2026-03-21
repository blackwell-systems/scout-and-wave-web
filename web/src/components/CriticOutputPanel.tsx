import { useState, useEffect, useRef } from 'react'

export interface CriticOutputPanelProps {
  output: string
  running: boolean
  error: string | null
}

export function CriticOutputPanel({ output, running, error }: CriticOutputPanelProps): JSX.Element | null {
  const [displayed, setDisplayed] = useState('')
  const [collapsed, setCollapsed] = useState(true)
  const preRef = useRef<HTMLPreElement>(null)

  // Typewriter effect: advance `displayed` toward `output` one rAF at a time.
  // Step size scales with backlog so it catches up fast but feels smooth at low lag.
  useEffect(() => {
    if (displayed.length >= output.length) return
    const id = requestAnimationFrame(() => {
      const backlog = output.length - displayed.length
      const step = Math.min(backlog, Math.max(4, Math.floor(backlog / 6)))
      setDisplayed(output.slice(0, displayed.length + step))
    })
    return () => cancelAnimationFrame(id)
  }, [output, displayed])

  // Reset displayed text when output is cleared (new run)
  useEffect(() => {
    if (output === '') setDisplayed('')
  }, [output])

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight
    }
  }, [displayed])

  // Nothing to show
  if (!running && !error && !output) return null

  // Error banner
  if (error) {
    return (
      <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        <span className="font-medium">Critic error:</span> {error}
      </div>
    )
  }

  // Running with no output yet — spinner
  if (running && !output) {
    return (
      <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Starting critic review…
      </div>
    )
  }

  // Completed — collapsible
  if (!running && output) {
    return (
      <div className="mt-3">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className={`transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
          Critic output
        </button>
        {!collapsed && (
          <pre
            ref={preRef}
            className="mt-2 max-h-72 overflow-auto rounded bg-zinc-900 p-3 text-xs font-mono text-zinc-300 border border-border"
          >
            {displayed}
          </pre>
        )}
      </div>
    )
  }

  // Running with output — live stream
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Critic reviewing…
      </div>
      <pre
        ref={preRef}
        className="max-h-72 overflow-auto rounded bg-zinc-900 p-3 text-xs font-mono text-zinc-300 border border-border"
      >
        {displayed}
      </pre>
    </div>
  )
}
