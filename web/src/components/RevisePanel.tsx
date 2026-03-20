import { useState, useEffect, useRef } from 'react'
import { fetchImplRaw, saveImplRaw, runImplRevise, subscribeReviseEvents, cancelRevise } from '../api'

interface RevisePanelProps {
  slug: string
  onBack: () => void
  onSaved: () => void
}

export default function RevisePanel({ slug, onBack, onSaved }: RevisePanelProps): JSX.Element {
  const [raw, setRaw] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const [feedback, setFeedback] = useState('')
  const [revising, setRevising] = useState(false)
  const [reviseOutput, setReviseOutput] = useState('')
  const [reviseError, setReviseError] = useState<string | null>(null)
  const [reviseDone, setReviseDone] = useState(false)

  const esRef = useRef<EventSource | null>(null)
  const reviseRunIdRef = useRef<string | null>(null)
  const outputRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    fetchImplRaw(slug)
      .then(setRaw)
      .catch(e => setLoadError(e.message))
  }, [slug])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [reviseOutput])

  useEffect(() => () => { esRef.current?.close() }, [])

  async function handleSave() {
    setSaveStatus('saving')
    try {
      await saveImplRaw(slug, raw)
      setSaveStatus('saved')
      onSaved()
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (e) {
      setSaveStatus('error')
    }
  }

  async function handleRevise() {
    if (!feedback.trim() || revising) return
    setRevising(true)
    setReviseOutput('')
    setReviseError(null)
    setReviseDone(false)

    let runId: string
    try {
      const result = await runImplRevise(slug, feedback.trim())
      runId = result.runId
      reviseRunIdRef.current = runId
    } catch (e) {
      setReviseError(e instanceof Error ? e.message : String(e))
      setRevising(false)
      return
    }

    const es = subscribeReviseEvents(slug, runId)
    esRef.current = es

    es.addEventListener('revise_output', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { chunk?: string }
        setReviseOutput(prev => prev + (payload.chunk ?? e.data))
      } catch {
        setReviseOutput(prev => prev + e.data)
      }
    })

    es.addEventListener('revise_complete', () => {
      es.close()
      esRef.current = null
      setRevising(false)
      setReviseDone(true)
      // Reload the raw markdown so the textarea reflects Claude's edits.
      fetchImplRaw(slug).then(setRaw).catch(() => {})
      onSaved()
    })

    es.addEventListener('revise_cancelled', () => {
      es.close()
      esRef.current = null
      setRevising(false)
      setReviseOutput('')
    })

    es.addEventListener('revise_failed', (e: MessageEvent) => {
      es.close()
      esRef.current = null
      setRevising(false)
      try {
        const payload = JSON.parse(e.data) as { error?: string }
        setReviseError(payload.error ?? 'Revision failed')
      } catch {
        setReviseError('Revision failed')
      }
    })

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        esRef.current = null
        setRevising(false)
        setReviseError(prev => prev ?? 'Connection lost')
      }
    }
  }

  return (
    <div className="h-full bg-background overflow-y-auto">
      <div className="max-w-[1200px] mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back
          </button>
          <div>
            <h1 className="text-2xl font-bold">Request Changes</h1>
            <p className="text-sm text-muted-foreground font-mono mt-0.5">{slug}</p>
          </div>
        </div>

        {loadError && (
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-red-800 dark:text-red-400 text-sm">
            Failed to load IMPL doc: {loadError}
          </div>
        )}

        {/* Ask Claude */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold">Ask Claude to revise</h2>
          <p className="text-sm text-muted-foreground">
            Describe what to change. Claude will revise the IMPL doc based on your
            feedback — for example: &quot;Add a wave 2 agent for the database migration&quot; or
            &quot;Split Agent A into two agents to reduce file ownership overlap.&quot;
          </p>
          <textarea
            className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm font-mono resize-none outline-none focus:ring-1 focus:ring-primary min-h-[80px]"
            placeholder="Describe the changes you want Claude to make…"
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            disabled={revising}
          />
          <div className="flex items-center gap-3">
            <button
              onClick={handleRevise}
              disabled={revising || !feedback.trim()}
              className="px-4 py-1.5 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-800 text-white transition-colors disabled:cursor-not-allowed"
            >
              {revising ? 'Revising…' : 'Ask Claude'}
            </button>
            {revising && (
              <button
                onClick={() => { if (reviseRunIdRef.current) cancelRevise(slug, reviseRunIdRef.current) }}
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-muted-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
            )}
            {reviseDone && (
              <span className="text-sm text-green-600 dark:text-green-400">✓ Done — doc updated</span>
            )}
          </div>

          {reviseError && (
            <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-red-800 dark:text-red-400 text-sm">
              {reviseError}
            </div>
          )}

          {(reviseOutput || revising) && (
            <div className="bg-gray-900 dark:bg-gray-950 border border-gray-700 rounded-lg">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700">
                <span className="text-xs font-medium text-gray-400">Claude output</span>
                {revising && <span className="text-xs text-blue-400 animate-pulse">running</span>}
              </div>
              <pre
                ref={outputRef}
                className="p-4 text-xs text-gray-200 font-mono whitespace-pre-wrap overflow-y-auto max-h-[40vh] leading-relaxed"
              >
                {reviseOutput || (revising ? 'Starting…' : ' ')}
              </pre>
            </div>
          )}
        </div>

        {/* Manual edit */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold">Edit manually</h2>
          <textarea
            className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm font-mono resize-none outline-none focus:ring-1 focus:ring-primary min-h-[500px] disabled:opacity-50 disabled:cursor-not-allowed"
            value={raw}
            onChange={e => setRaw(e.target.value)}
            disabled={revising}
            spellCheck={false}
          />
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving' || revising}
              className="px-4 py-1.5 text-sm font-medium rounded-md bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-50"
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save'}
            </button>
            {saveStatus === 'saved' && (
              <span className="text-sm text-green-600 dark:text-green-400">✓ Saved</span>
            )}
            {saveStatus === 'error' && (
              <span className="text-sm text-red-500">Save failed</span>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
