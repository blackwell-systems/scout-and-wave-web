import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

// TEMP stub — remove after Wave 1 merge (Agent B adds this to api.ts)
async function fetchFileDiff(slug: string, agent: string, wave: number, file: string): Promise<string> {
  const r = await fetch(
    `/api/impl/${encodeURIComponent(slug)}/wave/${wave}/agent/${encodeURIComponent(agent)}/diff?file=${encodeURIComponent(file)}`
  )
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.text()
}

interface FileDiffPanelProps {
  slug: string
  agent: string
  wave: number
  file: string
  onBack: () => void
}

type LineType = 'added' | 'removed' | 'hunk' | 'unchanged'

interface DiffLine {
  type: LineType
  content: string
}

function parseDiffLines(raw: string): DiffLine[] {
  return raw.split('\n').map(line => {
    if (line.startsWith('+') && !line.startsWith('+++')) return { type: 'added', content: line }
    if (line.startsWith('-') && !line.startsWith('---')) return { type: 'removed', content: line }
    if (line.startsWith('@@')) return { type: 'hunk', content: line }
    return { type: 'unchanged', content: line }
  })
}

function lineClass(type: LineType): string {
  switch (type) {
    case 'added':   return 'bg-green-500/15 text-green-800 dark:text-green-300'
    case 'removed': return 'bg-red-500/15 text-red-800 dark:text-red-300'
    case 'hunk':    return 'bg-blue-500/10 text-blue-700 dark:text-blue-400 font-semibold'
    default:        return 'text-foreground/80'
  }
}

export default function FileDiffPanel({ slug, agent, wave, file, onBack }: FileDiffPanelProps): JSX.Element {
  const [diff, setDiff] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setDiff(null)

    fetchFileDiff(slug, agent, wave, file)
      .then(text => {
        if (!cancelled) {
          setDiff(text)
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
  }, [slug, agent, wave, file])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <span aria-hidden>←</span> Back
          </button>
          <span className="text-muted-foreground/40">|</span>
          <CardTitle className="text-sm font-mono truncate">{file}</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">
          Wave {wave} · Agent {agent}
        </p>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground text-sm">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading diff…
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
            Failed to load diff: {error}
          </div>
        )}

        {diff !== null && !loading && (
          diff.trim() === '' ? (
            <p className="text-sm text-muted-foreground">No diff available for this file.</p>
          ) : (
            <div className="overflow-x-auto">
              <pre className="text-[11px] font-mono leading-5">
                {parseDiffLines(diff).map((line, idx) => (
                  <div key={idx} className={`px-2 ${lineClass(line.type)}`}>
                    {line.content || '\u00a0'}
                  </div>
                ))}
              </pre>
            </div>
          )
        )}
      </CardContent>
    </Card>
  )
}
