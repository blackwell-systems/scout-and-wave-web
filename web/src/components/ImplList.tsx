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

export default function ImplList(props: ImplListProps): JSX.Element {
  const { entries, selectedSlug, onSelect, onDelete, loading, repos } = props

  const activeEntries = entries.filter((e) => e.doc_status !== 'complete')
  const completedEntries = entries.filter((e) => e.doc_status === 'complete')

  return (
    <div className="flex flex-col gap-1 p-2">
      {repos && repos.length >= 2 && (
        <>
          <select className="w-full text-xs px-2 py-1 mb-2 rounded border border-border bg-background text-foreground">
            <option value="">All repos</option>
            {repos.map((r, i) => <option key={i} value={r.path}>{r.name || r.path}</option>)}
          </select>
          {/* TODO: filter entries by active repo */}
        </>
      )}
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-xs px-2">
          No IMPL docs found. Run <code className="bg-muted px-1 rounded">saw scout</code> first.
        </p>
      ) : (
        <>
          {activeEntries.map((e) => {
            const isSelected = e.slug === selectedSlug
            return (
              <div key={e.slug} className="group relative flex items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'flex-1 justify-start font-mono text-xs pr-6',
                    isSelected && 'bg-accent border-l-2 border-primary rounded-none'
                  )}
                  disabled={loading}
                  onClick={() => onSelect(e.slug)}
                >
                  {e.slug}
                  {isMultiRepo(e.slug) && (
                    <>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300 ml-1 font-mono">multi</span>
                      {/* TODO: detect from file ownership paths */}
                    </>
                  )}
                </Button>
                <button
                  onClick={(ev) => { ev.stopPropagation(); if (confirm(`Delete "${e.slug}"?`)) onDelete(e.slug) }}
                  className="absolute right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-destructive transition-opacity"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            )
          })}

          {completedEntries.length > 0 && (
            <>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground pt-2">
                Completed
              </p>
              {completedEntries.map((e) => {
                const isSelected = e.slug === selectedSlug
                return (
                  <div key={e.slug} className="group relative flex items-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        'flex-1 justify-start font-mono text-xs pr-6',
                        isSelected
                          ? 'bg-accent border-l-2 border-primary rounded-none'
                          : 'opacity-60 hover:opacity-100'
                      )}
                      disabled={loading}
                      onClick={() => onSelect(e.slug)}
                    >
                      {'\u2713 '}{e.slug}
                      {isMultiRepo(e.slug) && (
                        <>
                          <span className="text-[9px] px-1 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300 ml-1 font-mono">multi</span>
                          {/* TODO: detect from file ownership paths */}
                        </>
                      )}
                    </Button>
                    <button
                      onClick={(ev) => { ev.stopPropagation(); if (confirm(`Delete "${e.slug}"?`)) onDelete(e.slug) }}
                      className="absolute right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-destructive transition-opacity"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </>
          )}
        </>
      )}
    </div>
  )
}
