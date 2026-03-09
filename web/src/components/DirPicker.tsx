import { useState, useEffect, useRef } from 'react'
import { browse, browseNative, BrowseResult } from '../api'

interface DirPickerProps {
  value: string
  onChange: (path: string) => void
}

export default function DirPicker({ value, onChange }: DirPickerProps): JSX.Element {
  const [nativeUnavailable, setNativeUnavailable] = useState(false)
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<BrowseResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const openFallback = async (path?: string) => {
    setOpen(true)
    setLoading(true)
    setError(null)
    try {
      const r = await browse(path ?? (value || undefined))
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleChoose = async () => {
    if (!nativeUnavailable) {
      try {
        const path = await browseNative('Select a repository folder')
        if (path !== null) {
          onChange(path)
          return
        }
        // null = user cancelled — do nothing
        return
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg === 'unsupported') {
          setNativeUnavailable(true)
        } else {
          // unexpected error — fall through to fallback
          setNativeUnavailable(true)
        }
      }
    }
    openFallback()
  }

  const navigate = (path: string) => openFallback(path)

  const select = (path: string) => {
    onChange(path)
    setOpen(false)
  }

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
          onClick={handleChoose}
          className="text-sm px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted transition-colors whitespace-nowrap"
        >
          Choose Folder…
        </button>
      </div>

      {/* Fallback filesystem picker — shown only when native is unavailable */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
            {result?.parent && (
              <button onClick={() => navigate(result.parent)} className="text-xs text-muted-foreground hover:text-foreground" title="Go up">↑</button>
            )}
            <span className="text-xs font-mono text-muted-foreground truncate flex-1">{result?.path ?? '…'}</span>
            <button onClick={() => result && select(result.path)} className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90">
              Select
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {loading && <p className="text-xs text-muted-foreground px-3 py-2">Loading…</p>}
            {error && <p className="text-xs text-destructive px-3 py-2">{error}</p>}
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
