import { useState, useEffect, useRef } from 'react'
import { browse, BrowseResult } from '../api'

interface DirPickerProps {
  value: string
  onChange: (path: string) => void
}

export default function DirPicker({ value, onChange }: DirPickerProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<BrowseResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const load = async (path?: string) => {
    setLoading(true)
    setError(null)
    try {
      const r = await browse(path)
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const openPicker = () => {
    setOpen(true)
    load(value || undefined)
  }

  const navigate = (path: string) => load(path)

  const select = (path: string) => {
    onChange(path)
    setOpen(false)
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="/path/to/repo"
          className="flex-1 text-sm px-3 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
        />
        <button
          type="button"
          onClick={openPicker}
          className="text-sm px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted transition-colors"
          title="Browse filesystem"
        >
          Browse
        </button>
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
          {/* Current path breadcrumb + Up button */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
            {result?.parent && (
              <button
                onClick={() => navigate(result.parent)}
                className="text-xs text-muted-foreground hover:text-foreground"
                title="Go up"
              >
                ↑
              </button>
            )}
            <span className="text-xs font-mono text-muted-foreground truncate flex-1">
              {result?.path ?? '…'}
            </span>
            <button
              onClick={() => result && select(result.path)}
              className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Select
            </button>
          </div>

          {/* Directory listing */}
          <div className="max-h-56 overflow-y-auto">
            {loading && (
              <p className="text-xs text-muted-foreground px-3 py-2">Loading…</p>
            )}
            {error && (
              <p className="text-xs text-destructive px-3 py-2">{error}</p>
            )}
            {!loading && !error && result?.entries.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-2">No subdirectories</p>
            )}
            {!loading && !error && result?.entries.map(entry => (
              <button
                key={entry.name}
                onClick={() => navigate(`${result.path}/${entry.name}`)}
                className="w-full text-left text-sm px-3 py-1.5 hover:bg-accent flex items-center gap-2"
              >
                <span className="text-muted-foreground text-xs">📁</span>
                <span className="font-mono">{entry.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
