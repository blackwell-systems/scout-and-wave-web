import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { ScoutContext, RepoEntry } from '../types'

const WORKING_MESSAGES = [
  'Reading codebase…',
  'Mapping file ownership…',
  'Checking suitability…',
  'Designing wave structure…',
  'Defining interface contracts…',
  'Writing IMPL doc…',
]
import { runScout, subscribeScoutEvents, cancelScout } from '../api'
import { sawClient } from '../lib/apiClient'

interface ScoutLauncherProps {
  onComplete: (slug: string) => void
  onScoutReady?: () => void  // fires immediately when scout_complete fires (before user clicks Review)
  repos?: RepoEntry[]         // registered repos for dropdown
  activeRepo?: RepoEntry | null  // currently active repo (pre-select in dropdown)
}

const SESSION_KEY = 'saw-scout-context'

const inputCls = "w-full bg-muted border border-border rounded px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"

export default function ScoutLauncher({ onComplete, onScoutReady, repos, activeRepo }: ScoutLauncherProps): JSX.Element {
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [feature, setFeature] = useState('')
  const [repo, setRepo] = useState(() => activeRepo?.path ?? '')
  const [showRepo, setShowRepo] = useState(false)
  const [dropdownValue, setDropdownValue] = useState<string>(() => activeRepo?.path ?? '')
  const [showContext, setShowContext] = useState(false)
  const [contextData, setContextData] = useState<ScoutContext>(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY)
      if (raw) return JSON.parse(raw) as ScoutContext
    } catch {
      // ignore parse errors
    }
    return { files: [], notes: '', constraints: [] }
  })
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [displayed, setDisplayed] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [completedSlug, setCompletedSlug] = useState<string | null>(null)
  const [summaryData, setSummaryData] = useState<{ agents: number; waves: number; verdict: string; fileCount: number; contractCount: number } | null>(null)
  const [msgIdx, setMsgIdx] = useState(0)
  const runIdRef = useRef<string | null>(null)

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

  // Persist contextData to sessionStorage whenever it changes
  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(contextData))
    } catch {
      // ignore storage errors
    }
  }, [contextData])

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setMsgIdx(i => (i + 1) % WORKING_MESSAGES.length), 3000)
    return () => clearInterval(t)
  }, [running])
  const esRef = useRef<EventSource | null>(null)
  const outputRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    return () => {
      esRef.current?.close()
    }
  }, [])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [displayed])

  async function handleRun() {
    if (!feature.trim() || running) return
    if (feature.trim().length < 15) {
      setError('Please describe the feature in at least 15 characters.')
      return
    }
    setRunning(true)
    setOutput('')
    setDisplayed('')
    setError(null)
    setSummaryData(null)

    let runId: string
    try {
      if (mode === 'new') {
        const { runBootstrap } = await import('../lib/bootstrapApi')
        const result = await runBootstrap(feature.trim(), repo.trim() || undefined)
        runId = result.run_id
      } else {
        const result = await runScout(feature.trim(), repo.trim() || undefined, contextData)
        runId = result.runId
      }
      runIdRef.current = runId
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRunning(false)
      return
    }

    const es = subscribeScoutEvents(runId)
    esRef.current = es

    es.addEventListener('scout_output', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { chunk?: string }
        setOutput(prev => prev + (payload.chunk ?? e.data))
      } catch {
        setOutput(prev => prev + e.data)
      }
    })

    es.addEventListener('scout_complete', (e: MessageEvent) => {
      es.close()
      esRef.current = null
      setRunning(false)
      try {
        const payload = JSON.parse(e.data) as { slug?: string; impl_path?: string }
        const slug = payload.slug ?? payload.impl_path ?? ''
        setCompletedSlug(slug)
        onScoutReady?.()
        if (slug) {
          sawClient.impl.get(slug)
            .then((data: any) => {
              const agents = data.waves?.reduce((s: number, w: any) => s + (w.agents?.length ?? 0), 0) ?? 0
              const waves = data.waves?.length ?? 0
              const verdict = data.suitability?.verdict ?? ''
              const fileCount = Array.isArray(data.file_ownership) ? data.file_ownership.length : 0
              const contractsText: string = data.interface_contracts_text ?? data.interface_contracts ?? ''
              const contractCount = contractsText ? contractsText.split('\n').filter((l: string) => l.trim().length > 0).length : 0
              setSummaryData({ agents, waves, verdict, fileCount, contractCount })
            })
            .catch(() => {})
        }
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Scout complete', { body: slug ? `Plan ready: ${slug}` : 'Plan ready for review' })
        }
      } catch {
        setCompletedSlug('')
        onScoutReady?.()
      }
    })

    es.addEventListener('scout_cancelled', () => {
      es.close()
      esRef.current = null
      setRunning(false)
      setOutput('')
    })

    es.addEventListener('scout_failed', (e: MessageEvent) => {
      es.close()
      esRef.current = null
      setRunning(false)
      try {
        const payload = JSON.parse(e.data) as { error?: string }
        setError(payload.error ?? 'Scout failed')
      } catch {
        setError(e.data ?? 'Scout failed')
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleRun()
    }
  }

  const CONSTRAINTS = [
    'Minimize API surface changes',
    'Prefer additive changes (no deletions)',
    'Keep existing tests passing',
  ]

  function toggleConstraint(label: string) {
    setContextData(d => {
      const has = d.constraints.includes(label)
      return {
        ...d,
        constraints: has ? d.constraints.filter(c => c !== label) : [...d.constraints, label],
      }
    })
  }

  return (
    <div className="bg-background p-4 flex flex-col">
      <div className="w-full space-y-4">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-foreground">New Plan</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Describe the feature and Scout will produce an implementation plan.
          </p>
        </div>

        {/* Feature input */}
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm space-y-3">
          {/* Mode toggle */}
          <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium mb-1">
            <button
              type="button"
              onClick={() => setMode('existing')}
              className={`flex-1 py-1.5 transition-colors ${mode === 'existing' ? 'bg-primary/10 text-primary' : 'bg-background text-muted-foreground hover:bg-muted'}`}
              disabled={running}
            >
              Existing project
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`flex-1 py-1.5 transition-colors border-l border-border ${mode === 'new' ? 'bg-primary/10 text-primary' : 'bg-background text-muted-foreground hover:bg-muted'}`}
              disabled={running}
            >
              New project
            </button>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            {mode === 'existing'
              ? 'Scout will analyze your codebase and plan a feature addition.'
              : 'Scout will design and scaffold a new project from scratch.'}
          </p>
          <textarea
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none min-h-[80px] disabled:opacity-50"
            placeholder={mode === 'new'
              ? "e.g. 'A React app that tracks reading goals and shows weekly progress charts.'"
              : "e.g. 'Add a dark mode toggle to the settings screen that persists across sessions.'"}
            value={feature}
            onChange={e => setFeature(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={running}
          />
          {feature.trim().length > 0 && feature.trim().length < 15 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Be specific — describe what, where, and any constraints ({feature.trim().length}/15 min)
            </p>
          )}

          {/* Repo path — dropdown when registry is non-empty, freeform toggle otherwise */}
          <div>
            {repos && repos.length > 0 ? (
              <div className="space-y-2">
                <select
                  className={inputCls}
                  value={dropdownValue}
                  onChange={e => {
                    const val = e.target.value
                    setDropdownValue(val)
                    if (val === '') {
                      setRepo('')
                      setShowRepo(false)
                    } else if (val === '__custom__') {
                      setRepo('')
                      setShowRepo(true)
                    } else {
                      setRepo(val)
                      setShowRepo(false)
                    }
                  }}
                  disabled={running}
                >
                  <option value="">— select repo —</option>
                  {repos.map(r => (
                    <option key={r.path} value={r.path}>
                      {r.name || r.path}
                    </option>
                  ))}
                  <option value="__custom__">Custom path...</option>
                </select>
                {showRepo && (
                  <input
                    type="text"
                    className={inputCls}
                    placeholder="/path/to/repo"
                    value={repo}
                    onChange={e => setRepo(e.target.value)}
                    disabled={running}
                  />
                )}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowRepo(v => !v)}
                >
                  {showRepo ? '- Hide repo path' : '+ Repo path (optional)'}
                </button>
                {showRepo && (
                  <input
                    type="text"
                    className={`mt-2 ${inputCls}`}
                    placeholder="/path/to/repo"
                    value={repo}
                    onChange={e => setRepo(e.target.value)}
                    disabled={running}
                  />
                )}
              </>
            )}
          </div>

          {/* Context toggle */}
          <div>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowContext(v => !v)}
            >
              {showContext ? '- Hide context' : '+ Add context (optional)'}
            </button>
            {showContext && (
              <div className="mt-2 space-y-3">
                {/* File paths */}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Relevant file paths
                  </label>
                  <textarea
                    className={`${inputCls} resize-none min-h-[60px]`}
                    placeholder="Paste file paths, one per line"
                    defaultValue={contextData.files.join('\n')}
                    onBlur={e =>
                      setContextData(d => ({
                        ...d,
                        files: e.target.value.split('\n').filter(Boolean),
                      }))
                    }
                    disabled={running}
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Notes
                  </label>
                  <textarea
                    className={`${inputCls} resize-none min-h-[60px]`}
                    placeholder="Additional notes or constraints for the Scout agent"
                    value={contextData.notes}
                    onChange={e => setContextData(d => ({ ...d, notes: e.target.value }))}
                    disabled={running}
                  />
                </div>

                {/* Constraint checkboxes — hidden in new-project mode */}
                {mode === 'existing' && (
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Constraints
                    </label>
                    <div className="space-y-1">
                      {CONSTRAINTS.map(label => (
                        <label key={label} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="rounded border-border text-primary focus:ring-ring"
                            checked={contextData.constraints.includes(label)}
                            onChange={() => toggleConstraint(label)}
                            disabled={running}
                          />
                          <span className="text-xs text-foreground">{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Run / Cancel buttons */}
          <div className="flex items-stretch h-10 justify-end border-t border-border -mx-4 -mb-4 mt-2">
            {running && (
              <button
                onClick={() => { if (runIdRef.current) cancelScout(runIdRef.current) }}
                className="flex items-center justify-center text-sm font-medium px-6 transition-colors border-l bg-muted/60 hover:bg-muted text-muted-foreground border-border"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleRun}
              disabled={running || feature.trim().length < 15}
              className="flex items-center justify-center text-sm font-medium px-6 transition-colors border-l bg-blue-50/60 hover:bg-blue-100/80 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:hover:bg-blue-900/60 dark:text-blue-400 dark:border-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {running ? 'Running…' : mode === 'new' ? 'Run Bootstrap' : 'Run Scout'}
            </button>
          </div>
        </div>
        {!running && feature.trim().length > 0 && feature.trim().length < 15 && (
          <p className="text-xs text-muted-foreground text-right -mt-2">
            Describe in at least 15 characters to run Scout
          </p>
        )}

        {/* Error banner */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-3 text-destructive text-sm">
            <span className="font-medium">Error:</span> {error}
          </div>
        )}

        {/* Completion banner */}
        {completedSlug !== null && (
          <div className="flex items-center justify-between bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3">
            <div>
              <span className="text-sm font-medium text-green-800 dark:text-green-400">Scout Analysis Complete &#10003;</span>
              {summaryData && (
                <>
                  <p className="text-xs text-green-700 dark:text-green-500 mt-0.5">
                    Generated {summaryData.agents} agent{summaryData.agents !== 1 ? 's' : ''} across {summaryData.waves} wave{summaryData.waves !== 1 ? 's' : ''}.
                    {summaryData.fileCount > 0 && <> {summaryData.fileCount} file{summaryData.fileCount !== 1 ? 's' : ''} involved</>}
                    {summaryData.contractCount > 0 && <>, {summaryData.contractCount} interface contract{summaryData.contractCount !== 1 ? 's' : ''} defined</>}.
                    {' '}Ready for review.
                  </p>
                  <p className="text-xs text-green-600/70 dark:text-green-600 mt-0.5">
                    Next: Review wave structure and approve to launch agents.
                  </p>
                </>
              )}
            </div>
            <button
              onClick={() => onComplete(completedSlug)}
              className="text-sm font-medium px-3 py-1 rounded-md bg-green-600 hover:bg-green-700 text-white transition-colors"
            >
              Review →
            </button>
          </div>
        )}

        {/* Live output — rendered markdown, intentionally dark regardless of theme */}
        {(output || running) && (
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg shadow-sm">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
              <span className="text-xs font-medium text-zinc-400">Scout output</span>
              {running && (
                <span className="text-xs text-blue-400 animate-pulse">running</span>
              )}
            </div>
            <div
              ref={outputRef as React.RefObject<HTMLDivElement>}
              className="p-4 overflow-y-auto max-h-[50vh] scout-output"
            >
              {displayed ? (
                <ReactMarkdown
                  components={{
                    h1: ({ children }) => <h1 className="text-base font-bold text-zinc-100 mt-4 mb-2 first:mt-0">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-sm font-bold text-blue-400 mt-4 mb-1.5 first:mt-0">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-xs font-semibold text-zinc-300 mt-3 mb-1 first:mt-0">{children}</h3>,
                    p: ({ children }) => <p className="text-xs text-zinc-300 leading-relaxed mb-2">{children}</p>,
                    pre: ({ children }) => <div className="my-2">{children}</div>,
                    code: ({ className, children, ...props }) => {
                      const isBlock = Boolean(className?.startsWith('language-'))
                      return isBlock
                        ? <code className="block text-xs font-mono text-green-300 bg-zinc-900 rounded p-3 overflow-x-auto whitespace-pre" {...props}>{children}</code>
                        : <code className="text-xs font-mono text-amber-300 bg-zinc-800 px-1 rounded" {...props}>{children}</code>
                    },
                    ul: ({ children }) => <ul className="text-xs text-zinc-300 list-disc list-inside mb-2 space-y-0.5">{children}</ul>,
                    ol: ({ children }) => <ol className="text-xs text-zinc-300 list-decimal list-inside mb-2 space-y-0.5">{children}</ol>,
                    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                    strong: ({ children }) => <strong className="font-semibold text-zinc-100">{children}</strong>,
                    em: ({ children }) => <em className="text-zinc-400 italic">{children}</em>,
                    hr: () => <hr className="border-zinc-700 my-3" />,
                    table: ({ children }) => <div className="overflow-x-auto mb-3"><table className="text-xs text-zinc-300 border-collapse w-full">{children}</table></div>,
                    thead: ({ children }) => <thead className="text-zinc-400 border-b border-zinc-700">{children}</thead>,
                    th: ({ children }) => <th className="text-left px-2 py-1 font-medium">{children}</th>,
                    td: ({ children }) => <td className="px-2 py-1 border-t border-zinc-800">{children}</td>,
                    blockquote: ({ children }) => <blockquote className="border-l-2 border-zinc-600 pl-3 text-zinc-400 italic my-2">{children}</blockquote>,
                  }}
                >
                  {displayed}
                </ReactMarkdown>
              ) : (
                <p className="text-xs text-zinc-500 italic animate-pulse">{WORKING_MESSAGES[msgIdx]}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
