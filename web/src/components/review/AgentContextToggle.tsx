import { useState } from 'react'
import { fetchAgentContext } from '../../api'

interface AgentContextToggleProps {
  slug: string
  agent: string   // letter, e.g. "A"
  wave: number
}

export default function AgentContextToggle({ slug, agent, wave }: AgentContextToggleProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contextText, setContextText] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleToggle = async () => {
    if (open) {
      setOpen(false)
      return
    }

    // If we already have the data, just expand
    if (contextText !== null) {
      setOpen(true)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const resp = await fetchAgentContext(slug, agent)
      setContextText(resp.context_text)
      setOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!contextText) return
    try {
      await navigator.clipboard.writeText(contextText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard API unavailable — silently ignore
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleToggle}
          disabled={loading}
          className="text-xs border rounded px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {loading
            ? 'Loading...'
            : open
            ? `Hide Agent ${agent} Context`
            : `View Agent ${agent} Context (Wave ${wave})`}
        </button>

        {open && contextText !== null && (
          <button
            onClick={handleCopy}
            className="text-xs border rounded px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-1 text-xs text-red-500">{error}</p>
      )}

      {open && contextText !== null && (
        <pre className="mt-2 text-xs font-mono bg-muted/50 rounded p-3 overflow-x-scroll max-h-96 whitespace-pre-wrap">
          {contextText}
        </pre>
      )}
    </div>
  )
}
