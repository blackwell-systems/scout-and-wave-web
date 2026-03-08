import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

// TEMP stubs — remove after Wave 1 merge (Agent B adds these to api.ts)
async function getContext(): Promise<string> {
  const r = await fetch('/api/context')
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.text()
}

async function putContext(content: string): Promise<void> {
  const r = await fetch('/api/context', {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

export default function ContextViewerPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    getContext()
      .then(text => {
        if (!cancelled) {
          setContent(text)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [])

  function handleEdit() {
    setDraft(content ?? '')
    setSaveError(null)
    setEditing(true)
  }

  function handleCancelEdit() {
    setEditing(false)
    setSaveError(null)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      await putContext(draft)
      setContent(draft)
      setEditing(false)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Context</CardTitle>
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
            aria-label="Close"
          >
            × Close
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground text-sm">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading context…
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
            Failed to load context: {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {editing ? (
              <div className="space-y-3">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  className="w-full min-h-[300px] font-mono text-xs bg-muted/50 border border-border rounded-md p-3 text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                  spellCheck={false}
                />
                {saveError && (
                  <div className="text-xs text-red-700 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
                    Save failed: {saveError}
                  </div>
                )}
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={handleCancelEdit}
                    disabled={saving}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-muted hover:bg-muted/80 text-foreground border border-border transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {saving && (
                      <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                    )}
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <button
                    onClick={handleEdit}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-muted hover:bg-muted/80 text-foreground border border-border transition-colors"
                  >
                    Edit
                  </button>
                </div>
                {content ? (
                  <pre className="text-xs font-mono bg-muted/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap text-foreground/80 leading-relaxed min-h-[100px]">
                    {content}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">Context is empty.</p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
