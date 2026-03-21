// CreateFromImplsPanel — checklist panel for selecting standalone IMPLs
// to bundle into a new PROGRAM via conflict analysis.

import { useState, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import { Search, X, CheckSquare, Square } from 'lucide-react'
import type { PipelineEntry } from '../types/autonomy'

const STATUS_DOT: Record<string, string> = {
  complete:    'bg-green-500',
  executing:   'bg-blue-500 animate-pulse',
  'in-progress': 'bg-blue-500 animate-pulse',
  reviewed:    'bg-yellow-400',
  scouting:    'bg-purple-400',
  blocked:     'bg-red-500',
  'not-suitable': 'bg-red-500',
}

interface CreateFromImplsPanelProps {
  standalone: PipelineEntry[]
  onAnalyze: (slugs: string[]) => void
  onClose: () => void
}

export default function CreateFromImplsPanel({
  standalone,
  onAnalyze,
  onClose,
}: CreateFromImplsPanelProps): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    if (!filter) return standalone
    const q = filter.toLowerCase()
    return standalone.filter(
      (e) =>
        e.slug.toLowerCase().includes(q) ||
        (e.title && e.title.toLowerCase().includes(q)),
    )
  }, [standalone, filter])

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      // deselect all visible
      setSelected((prev) => {
        const next = new Set(prev)
        for (const e of filtered) next.delete(e.slug)
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const e of filtered) next.add(e.slug)
        return next
      })
    }
  }

  return (
    <Card className="w-[420px] max-h-[520px] flex flex-col shadow-xl border-border">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold">Create Program from IMPLs</CardTitle>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted text-muted-foreground"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </CardHeader>

      <CardContent className="flex flex-col gap-2 flex-1 overflow-hidden pb-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter IMPLs..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Select all / count */}
        <div className="flex items-center justify-between px-1 text-[10px] text-muted-foreground">
          <button
            onClick={toggleAll}
            className="flex items-center gap-1 hover:text-foreground transition-colors"
          >
            {selected.size === filtered.length && filtered.length > 0 ? (
              <CheckSquare className="w-3 h-3" />
            ) : (
              <Square className="w-3 h-3" />
            )}
            Select all
          </button>
          <span>{selected.size} selected</span>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              {standalone.length === 0
                ? 'No standalone IMPLs found'
                : 'No IMPLs match filter'}
            </p>
          ) : (
            filtered.map((entry) => {
              const isChecked = selected.has(entry.slug)
              const dot = STATUS_DOT[entry.status] ?? 'bg-gray-400'

              return (
                <button
                  key={entry.slug}
                  onClick={() => toggle(entry.slug)}
                  className={`w-full text-left px-2 py-2 rounded-md text-xs transition-colors flex items-center gap-2 ${
                    isChecked
                      ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-900 dark:text-violet-200'
                      : 'hover:bg-muted text-foreground'
                  }`}
                >
                  {isChecked ? (
                    <CheckSquare className="w-3.5 h-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
                  ) : (
                    <Square className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                  <span className="truncate font-medium flex-1">{entry.slug}</span>
                  {entry.repo && (
                    <span className="text-[10px] text-muted-foreground shrink-0">{entry.repo}</span>
                  )}
                </button>
              )
            })
          )}
        </div>

        {/* Analyze button */}
        <button
          disabled={selected.size < 2}
          onClick={() => onAnalyze(Array.from(selected))}
          className="w-full py-2 rounded-md text-xs font-medium transition-colors bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Analyze {selected.size > 0 ? `(${selected.size})` : ''}
        </button>
      </CardContent>
    </Card>
  )
}
