import { useState, useRef, useEffect } from 'react'
import { IMPLListEntry, RepoEntry, IMPLDocResponse } from '../types'
import { fetchImpl } from '../api'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'

interface ImplListProps {
  entries: IMPLListEntry[]
  selectedSlug: string | null
  onSelect: (slug: string) => void
  onDelete: (slug: string) => void
  loading: boolean
  repos?: RepoEntry[]
}

interface DeleteModalProps {
  slug: string
  onConfirm: () => void
  onCancel: () => void
}

function DeleteModal({ slug, onConfirm, onCancel }: DeleteModalProps): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="bg-background border border-border rounded-lg shadow-lg p-5 w-80 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Delete plan?</span>
          <span className="text-xs text-muted-foreground">
            This will permanently remove{' '}
            <code className="font-mono text-destructive bg-destructive/10 px-1 rounded">{slug}</code>{' '}
            from disk. This cannot be undone.
          </span>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="text-xs px-3 py-1.5 rounded-md bg-destructive hover:bg-destructive/90 text-destructive-foreground font-medium transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

interface EntryRowProps {
  e: IMPLListEntry
  selectedSlug: string | null
  loading: boolean
  onSelect: (slug: string) => void
  onRequestDelete: (slug: string) => void
}

function HoverCard({ slug }: { slug: string; anchorRef?: React.RefObject<HTMLDivElement> }) {
  const [data, setData] = useState<IMPLDocResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchImpl(slug).then(d => { setData(d); setLoading(false) }).catch(() => setLoading(false))
  }, [slug])

  const totalAgents = data?.waves.reduce((sum, w) => sum + w.agents.length, 0) ?? 0

  return (
    <div className="absolute left-full top-0 ml-2 z-50 w-56 bg-popover border border-border rounded-lg shadow-xl p-3 text-xs pointer-events-none">
      <p className="font-medium text-foreground truncate mb-2">{slug}</p>
      {loading ? (
        <div className="space-y-1.5">
          <div className="animate-pulse h-3 bg-muted rounded w-3/4" />
          <div className="animate-pulse h-3 bg-muted rounded w-1/2" />
        </div>
      ) : data ? (
        <div className="space-y-1 text-muted-foreground">
          <div className="flex justify-between">
            <span>Status</span>
            <span className={`font-medium ${data.doc_status === 'complete' ? 'text-primary' : 'text-green-500'}`}>
              {data.doc_status}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Waves</span>
            <span className="font-medium text-foreground">{data.waves.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Agents</span>
            <span className="font-medium text-foreground">{totalAgents}</span>
          </div>
          <div className="flex justify-between">
            <span>Suitability</span>
            <span className={`font-medium ${data.suitability.verdict === 'SUITABLE' ? 'text-green-500' : data.suitability.verdict === 'NOT SUITABLE' ? 'text-destructive' : 'text-muted-foreground'}`}>
              {data.suitability.verdict === 'SUITABLE' ? '✓' : data.suitability.verdict === 'NOT SUITABLE' ? '✗' : '?'}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground">Failed to load</p>
      )}
    </div>
  )
}

function EntryRow({ e, selectedSlug, loading, onSelect, onRequestDelete }: EntryRowProps): JSX.Element {
  const isSelected = e.slug === selectedSlug
  const isComplete = e.doc_status === 'complete'
  const [showCard, setShowCard] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  const handleMouseEnter = () => {
    timerRef.current = setTimeout(() => setShowCard(true), 400)
  }
  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setShowCard(false)
  }

  return (
    <div className="group relative flex items-center" ref={rowRef} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {showCard && <HoverCard slug={e.slug} anchorRef={rowRef} />}
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'flex-1 justify-start font-mono text-xs pr-6 gap-1.5 flex-col items-start h-auto py-1.5',
          isSelected && 'bg-primary/10 border-l-2 border-primary rounded-none',
          isComplete && !isSelected && 'opacity-40 text-muted-foreground line-through hover:opacity-80 hover:no-underline'
        )}
        disabled={loading}
        onClick={() => onSelect(e.slug)}
      >
        <div className="flex items-center gap-1.5 w-full">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isComplete ? 'bg-primary/40' : 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]'}`} />
          <span className="truncate">{isComplete ? '✓ ' : ''}{e.slug}</span>
          {e.is_multi_repo && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300 font-mono shrink-0">multirepo</span>
          )}
        </div>
        {e.involved_repos && e.involved_repos.length > 0 && (
          <div className="flex items-center gap-2 pl-3 font-sans not-italic" style={{ textDecoration: 'none' }}>
            <span className="text-[10px] text-muted-foreground/70">
              {e.involved_repos.join(', ')}
            </span>
          </div>
        )}
        {(e.wave_count ?? 0) > 0 && (
          <div className="flex items-center gap-2 pl-3 font-sans not-italic" style={{ textDecoration: 'none' }}>
            <span className="text-[10px] text-muted-foreground/70">
              {e.wave_count} {e.wave_count === 1 ? 'wave' : 'waves'} · {e.agent_count} {e.agent_count === 1 ? 'agent' : 'agents'}
            </span>
          </div>
        )}
      </Button>
      <button
        onClick={(ev) => { ev.stopPropagation(); onRequestDelete(e.slug) }}
        className="absolute right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-destructive transition-opacity"
        title="Delete"
      >
        ✕
      </button>
    </div>
  )
}

export default function ImplList(props: ImplListProps): JSX.Element {
  const { entries, selectedSlug, onSelect, onDelete, loading, repos } = props
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<string>('')

  // Filter entries by selected repo (empty string = all repos)
  const filteredEntries = selectedRepo === ''
    ? entries
    : entries.filter((e) => e.repo === selectedRepo)

  const activeEntries = filteredEntries.filter((e) => e.doc_status !== 'complete')
  const completedEntries = filteredEntries.filter((e) => e.doc_status === 'complete')

  return (
    <>
      {pendingDelete && (
        <DeleteModal
          slug={pendingDelete}
          onConfirm={() => { onDelete(pendingDelete); setPendingDelete(null) }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      <div className="flex flex-col gap-1 p-2">
        {repos && repos.length >= 2 && (
          <>
            <select
              value={selectedRepo}
              onChange={(e) => setSelectedRepo(e.target.value)}
              className="w-full text-xs px-2 py-1 mb-2 rounded border border-border bg-background text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">All repos</option>
              {repos.map((r, i) => <option key={i} value={r.name}>{r.name || r.path}</option>)}
            </select>
          </>
        )}
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-xs px-2">
            No IMPL docs found. Run <code className="bg-muted px-1 rounded">saw scout</code> first.
          </p>
        ) : (
          <>
            {activeEntries.map((e) => (
              <EntryRow
                key={e.slug}
                e={e}
                selectedSlug={selectedSlug}
                loading={loading}
                onSelect={onSelect}
                onRequestDelete={setPendingDelete}
              />
            ))}
            {completedEntries.length > 0 && (
              <>
                <div className="h-px bg-border my-2" />
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground px-2 pb-1">
                  Completed
                </p>
                {completedEntries.map((e) => (
                  <EntryRow
                    key={e.slug}
                    e={e}
                    selectedSlug={selectedSlug}
                    loading={loading}
                    onSelect={onSelect}
                    onRequestDelete={setPendingDelete}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}
