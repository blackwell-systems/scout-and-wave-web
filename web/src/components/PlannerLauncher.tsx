import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { RepoEntry } from '../types'
import { runPlanner, subscribePlannerEvents, cancelPlanner } from '../programApi'

const WORKING_MESSAGES = [
  'Reading project requirements…',
  'Analyzing codebase structure…',
  'Identifying feature boundaries…',
  'Mapping cross-feature dependencies…',
  'Designing tier structure…',
  'Defining program contracts…',
  'Writing PROGRAM manifest…',
]

interface PlannerLauncherProps {
  onComplete: (slug: string) => void
  repos?: RepoEntry[]
  activeRepo?: RepoEntry | null
}

const inputCls = "w-full bg-muted border border-border rounded px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"

export default function PlannerLauncher({ onComplete, repos, activeRepo }: PlannerLauncherProps): JSX.Element {
  const [description, setDescription] = useState('')
  const [repo, setRepo] = useState(() => activeRepo?.path ?? '')
  const [showRepo, setShowRepo] = useState(false)
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [displayed, setDisplayed] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [completedSlug, setCompletedSlug] = useState<string | null>(null)
  const [msgIdx, setMsgIdx] = useState(0)
  const runIdRef = useRef<string | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const outputRef = useRef<HTMLPreElement | null>(null)

  // Typewriter effect
  useEffect(() => {
    if (displayed.length >= output.length) return
    const id = requestAnimationFrame(() => {
      const backlog = output.length - displayed.length
      const step = Math.min(backlog, Math.max(4, Math.floor(backlog / 6)))
      setDisplayed(output.slice(0, displayed.length + step))
    })
    return () => cancelAnimationFrame(id)
  }, [output, displayed])

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setMsgIdx(i => (i + 1) % WORKING_MESSAGES.length), 3000)
    return () => clearInterval(t)
  }, [running])

  useEffect(() => {
    return () => { esRef.current?.close() }
  }, [])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [displayed])

  async function handleRun() {
    if (!description.trim() || running) return
    if (description.trim().length < 15) {
      setError('Please describe the project in at least 15 characters.')
      return
    }
    setRunning(true)
    setOutput('')
    setDisplayed('')
    setError(null)

    let runId: string
    try {
      const result = await runPlanner(description.trim(), repo.trim() || undefined)
      runId = result.runId
      runIdRef.current = runId
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRunning(false)
      return
    }

    const es = subscribePlannerEvents(runId)
    esRef.current = es

    es.addEventListener('planner_output', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { chunk?: string }
        setOutput(prev => prev + (payload.chunk ?? e.data))
      } catch {
        setOutput(prev => prev + e.data)
      }
    })

    es.addEventListener('planner_complete', (e: MessageEvent) => {
      es.close()
      esRef.current = null
      setRunning(false)
      try {
        const payload = JSON.parse(e.data) as { slug?: string; program_path?: string }
        const slug = payload.slug ?? ''
        setCompletedSlug(slug)
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Planner complete', { body: slug ? `Program plan ready: ${slug}` : 'Program plan ready for review' })
        }
      } catch {
        setCompletedSlug('')
      }
    })

    es.addEventListener('planner_cancelled', () => {
      es.close()
      esRef.current = null
      setRunning(false)
      setOutput('')
    })

    es.addEventListener('planner_failed', (e: MessageEvent) => {
      es.close()
      esRef.current = null
      setRunning(false)
      try {
        const payload = JSON.parse(e.data) as { error?: string }
        setError(payload.error ?? 'Planner failed')
      } catch {
        setError(e.data ?? 'Planner failed')
      }
    })

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        esRef.current = null
        setRunning(false)
        setError(prev => prev ?? 'Connection lost')
      }
    }
  }

  function handleCancel() {
    if (runIdRef.current) {
      cancelPlanner(runIdRef.current).catch(() => {})
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRun()
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Project Description</label>
        <textarea
          className={inputCls + " min-h-[80px] resize-y"}
          placeholder="Describe the full project — features, goals, tech stack, scale. The Planner will decompose it into IMPLs organized into dependency-ordered tiers."
          value={description}
          onChange={e => setDescription(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          rows={4}
        />
      </div>

      <div>
        <button
          onClick={() => setShowRepo(v => !v)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showRepo ? '▾' : '▸'} Repo path
        </button>
        {showRepo && (
          <div className="mt-2 flex flex-col gap-1">
            {repos && repos.length > 0 && (
              <select
                className={inputCls}
                value={repo}
                onChange={e => setRepo(e.target.value)}
                disabled={running}
              >
                <option value="">Server default</option>
                {repos.map(r => (
                  <option key={r.path} value={r.path}>{r.name || r.path}</option>
                ))}
              </select>
            )}
            <input
              className={inputCls}
              placeholder="/absolute/path/to/repo"
              value={repo}
              onChange={e => setRepo(e.target.value)}
              disabled={running}
            />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleRun}
          disabled={running || !description.trim()}
          className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 px-4 rounded transition-colors"
        >
          {running ? WORKING_MESSAGES[msgIdx] : 'Run Planner'}
        </button>
        {running && (
          <button
            onClick={handleCancel}
            className="px-3 py-2 text-sm border border-border rounded hover:bg-muted transition-colors text-muted-foreground"
          >
            Cancel
          </button>
        )}
      </div>

      {error && (
        <div className="text-destructive text-xs bg-destructive/10 border border-destructive/20 rounded p-2">
          {error}
        </div>
      )}

      {(output || displayed) && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Planner Output</label>
          <pre
            ref={outputRef}
            className="bg-zinc-950 text-zinc-200 text-xs rounded p-3 overflow-y-auto max-h-[320px] whitespace-pre-wrap font-mono"
          >
            <ReactMarkdown>{displayed}</ReactMarkdown>
          </pre>
        </div>
      )}

      {completedSlug !== null && (
        <div className="flex flex-col gap-2 p-3 bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded">
          <p className="text-sm font-medium text-violet-800 dark:text-violet-300">
            Program plan ready: <span className="font-mono">{completedSlug}</span>
          </p>
          <button
            onClick={() => onComplete(completedSlug)}
            className="self-start text-sm bg-violet-600 hover:bg-violet-700 text-white px-4 py-1.5 rounded transition-colors"
          >
            View Program →
          </button>
        </div>
      )}
    </div>
  )
}
