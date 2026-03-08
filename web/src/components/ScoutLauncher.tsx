import { useState, useRef, useEffect } from 'react'
import { runScout, subscribeScoutEvents } from '../api'

interface ScoutLauncherProps {
  onComplete: (slug: string) => void
}

export default function ScoutLauncher({ onComplete }: ScoutLauncherProps): JSX.Element {
  const [feature, setFeature] = useState('')
  const [repo, setRepo] = useState('')
  const [showRepo, setShowRepo] = useState(false)
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [completedSlug, setCompletedSlug] = useState<string | null>(null)
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
    setRunning(true)
    setOutput('')
    setError(null)

    let runId: string
    try {
      const result = await runScout(feature.trim(), repo.trim() || undefined)
      runId = result.runId
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
      } catch {
        setCompletedSlug('')
      }
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

          {/* Repo path toggle */}
          <div>
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
          </div>

          {/* Run button */}
          <div className="flex justify-end">
            <button
              onClick={handleRun}
              disabled={running || !feature.trim()}
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
              {output || ' '}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
