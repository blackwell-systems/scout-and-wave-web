import { useState } from 'react'
import { IMPLListEntry, RepoEntry } from '../types'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'

const MULTI_REPO_KEYWORDS = ['cross-repo', 'multi-repo', 'engine', 'extraction']

function isMultiRepo(slug: string): boolean {
  return MULTI_REPO_KEYWORDS.some((kw) => slug.includes(kw))
}

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

function EntryRow({ e, selectedSlug, loading, onSelect, onRequestDelete }: EntryRowProps): JSX.Element {
  const isSelected = e.slug === selectedSlug
  const isComplete = e.doc_status === 'complete'
  return (
    <div className="group relative flex items-center">
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'flex-1 justify-start font-mono text-xs pr-6',
          isSelected && 'bg-primary/10 border-l-2 border-primary rounded-none',
          isComplete && !isSelected && 'opacity-40 text-muted-foreground line-through hover:opacity-80 hover:no-underline'
        )}
        disabled={loading}
        onClick={() => onSelect(e.slug)}
      >
        {isComplete ? '\u2713 ' : ''}{e.slug}
        {isMultiRepo(e.slug) && (
          <>
            <span className="text-[9px] px-1 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300 ml-1 font-mono">multirepo</span>
          </>
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

  const activeEntries = entries.filter((e) => e.doc_status !== 'complete')
  const completedEntries = entries.filter((e) => e.doc_status === 'complete')

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
            <select className="w-full text-xs px-2 py-1 mb-2 rounded border border-border bg-background text-foreground">
              <option value="">All repos</option>
              {repos.map((r, i) => <option key={i} value={r.path}>{r.name || r.path}</option>)}
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
