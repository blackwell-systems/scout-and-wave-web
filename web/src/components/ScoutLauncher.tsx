import { useState, useRef, useEffect } from 'react'
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

interface ScoutLauncherProps {
  onComplete: (slug: string) => void
  onScoutReady?: () => void  // fires immediately when scout_complete fires (before user clicks Review)
  repos?: RepoEntry[]         // registered repos for dropdown
  activeRepo?: RepoEntry | null  // currently active repo (pre-select in dropdown)
}

const SESSION_KEY = 'saw-scout-context'

export default function ScoutLauncher({ onComplete, onScoutReady, repos, activeRepo }: ScoutLauncherProps): JSX.Element {
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
  const [error, setError] = useState<string | null>(null)
  const [completedSlug, setCompletedSlug] = useState<string | null>(null)
  const [msgIdx, setMsgIdx] = useState(0)
  const runIdRef = useRef<string | null>(null)

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
  }, [output])

  async function handleRun() {
    if (!feature.trim() || running) return
    if (feature.trim().length < 15) {
      setError('Please describe the feature in at least 15 characters.')
      return
    }
    setRunning(true)
    setOutput('')
    setError(null)

    let runId: string
    try {
      const result = await runScout(feature.trim(), repo.trim() || undefined, contextData)
      runId = result.runId
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
    <div className="bg-gray-50 dark:bg-gray-950 p-4 flex flex-col">
      <div className="w-full space-y-4">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">New Plan</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Describe the feature and Scout will produce an implementation plan.
          </p>
        </div>

        {/* Feature input */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm space-y-3">
          <textarea
            className="w-full bg-transparent text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 resize-none outline-none min-h-[80px]"
            placeholder="Describe the feature to build..."
            value={feature}
            onChange={e => setFeature(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={running}
          />

          {/* Repo path — dropdown when registry is non-empty, freeform toggle otherwise */}
          <div>
            {repos && repos.length > 0 ? (
              <div className="space-y-2">
                <select
                  className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-800 dark:text-gray-100 outline-none focus:ring-1 focus:ring-blue-500"
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
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
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
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  onClick={() => setShowRepo(v => !v)}
                >
                  {showRepo ? '- Hide repo path' : '+ Repo path (optional)'}
                </button>
                {showRepo && (
                  <input
                    type="text"
                    className="mt-2 w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
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
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              onClick={() => setShowContext(v => !v)}
            >
              {showContext ? '- Hide context' : '+ Add context (optional)'}
            </button>
            {showContext && (
              <div className="mt-2 space-y-3">
                {/* File paths */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Relevant file paths
                  </label>
                  <textarea
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500 resize-none min-h-[60px]"
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
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Notes
                  </label>
                  <textarea
                    className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded px-3 py-1.5 text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500 resize-none min-h-[60px]"
                    placeholder="Additional notes or constraints for the Scout agent"
                    value={contextData.notes}
                    onChange={e => setContextData(d => ({ ...d, notes: e.target.value }))}
                    disabled={running}
                  />
                </div>

                {/* Constraint checkboxes */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Constraints
                  </label>
                  <div className="space-y-1">
                    {CONSTRAINTS.map(label => (
                      <label key={label} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                          checked={contextData.constraints.includes(label)}
                          onChange={() => toggleConstraint(label)}
                          disabled={running}
                        />
                        <span className="text-xs text-gray-700 dark:text-gray-300">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Run / Cancel buttons */}
          <div className="flex justify-end gap-2">
            {running && (
              <button
                onClick={() => { if (runIdRef.current) cancelScout(runIdRef.current); }}
                className="px-4 py-1.5 text-sm font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleRun}
              disabled={running || feature.trim().length < 15}
              className="px-4 py-1.5 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-800 text-white transition-colors disabled:cursor-not-allowed"
            >
              {running ? 'Running...' : 'Run Scout'}
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-red-800 dark:text-red-400 text-sm">
            <span className="font-medium">Error:</span> {error}
          </div>
        )}

        {/* Completion banner */}
        {completedSlug !== null && (
          <div className="flex items-center justify-between bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3">
            <span className="text-sm font-medium text-green-800 dark:text-green-400">Plan ready</span>
            <button
              onClick={() => onComplete(completedSlug)}
              className="text-sm font-medium px-3 py-1 rounded-md bg-green-600 hover:bg-green-700 text-white transition-colors"
            >
              Review →
            </button>
          </div>
        )}

        {/* Live output */}
        {(output || running) && (
          <div className="bg-gray-900 dark:bg-gray-950 border border-gray-700 dark:border-gray-800 rounded-lg shadow-sm">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700 dark:border-gray-800">
              <span className="text-xs font-medium text-gray-400">Scout output</span>
              {running && (
                <span className="text-xs text-blue-400 animate-pulse">running</span>
              )}
            </div>
            <pre
              ref={outputRef}
              className="p-4 text-xs text-gray-200 font-mono whitespace-pre-wrap overflow-y-auto max-h-[50vh] leading-relaxed"
            >
              {output || (running ? WORKING_MESSAGES[msgIdx] : ' ')}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
