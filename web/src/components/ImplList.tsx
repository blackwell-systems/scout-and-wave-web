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
  onManageRepos?: () => void
  onRemoveRepo?: (repoName: string) => void
  onNewPlan?: () => void
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
        className="bg-background border border-border rounded-none shadow-lg p-5 w-80 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Delete plan?</span>
          <span className="text-xs text-muted-foreground">
            This will permanently remove{' '}
            <code className="font-mono text-destructive bg-destructive/10 px-1 rounded-none">{slug}</code>{' '}
            from disk. This cannot be undone.
          </span>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded-none border border-border bg-background text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="text-xs px-3 py-1.5 rounded-none bg-destructive hover:bg-destructive/90 text-destructive-foreground font-medium transition-colors"
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
    <div className="absolute left-full top-0 ml-2 z-50 w-56 bg-popover border border-border rounded-none shadow-xl p-3 text-xs pointer-events-none">
      <p className="font-medium text-foreground truncate mb-2">{slug}</p>
      {loading ? (
        <div className="space-y-1.5">
          <div className="animate-pulse h-3 bg-muted rounded-none w-3/4" />
          <div className="animate-pulse h-3 bg-muted rounded-none w-1/2" />
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
          'flex-1 justify-start font-mono text-xs pr-6 gap-1.5 flex-col items-start h-auto py-1.5 rounded-none',
          isSelected && 'bg-primary/10 border-l-2 border-primary rounded-none',
          isComplete && !isSelected && 'opacity-40 text-muted-foreground line-through hover:opacity-80 hover:no-underline'
        )}
        disabled={loading}
        onClick={() => onSelect(e.slug)}
      >
        <div className="flex items-center gap-1.5 w-full">
          <span className={`w-1.5 h-1.5 rounded-none shrink-0 ${
            e.is_executing
              ? 'bg-blue-500 animate-pulse shadow-[0_0_6px_rgba(59,130,246,0.7)]'
              : isComplete
                ? 'bg-primary/40'
                : 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]'
          }`} />
          <span className="truncate">{isComplete ? '✓ ' : ''}{e.slug}</span>
          {e.is_multi_repo && (
            <span className="text-[9px] px-1 py-0.5 rounded-none bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300 font-mono shrink-0">multirepo</span>
          )}
        </div>
        {e.is_multi_repo && e.involved_repos && e.involved_repos.length > 0 && (
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
        className="absolute right-1 opacity-0 group-hover:opacity-100 p-0.5 rounded-none text-muted-foreground hover:text-destructive transition-opacity"
        title="Delete"
      >
        ✕
      </button>
    </div>
  )
}

export default function ImplList(props: ImplListProps): JSX.Element {
  const { entries, selectedSlug, onSelect, onDelete, loading, repos, onManageRepos, onRemoveRepo, onNewPlan } = props
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [pendingRemoveRepo, setPendingRemoveRepo] = useState<string | null>(null)
  const [collapsedRepos, setCollapsedRepos] = useState<Set<string>>(new Set())
  const [showCompletedRepos, setShowCompletedRepos] = useState<Set<string>>(new Set())

  // Group entries by repo
  const entriesByRepo = entries.reduce((acc, entry) => {
    const repo = entry.repo || 'default'
    if (!acc[repo]) acc[repo] = []
    acc[repo].push(entry)
    return acc
  }, {} as Record<string, IMPLListEntry[]>)

  const toggleRepo = (repoName: string) => {
    setCollapsedRepos(prev => {
      const next = new Set(prev)
      if (next.has(repoName)) {
        next.delete(repoName)
      } else {
        next.add(repoName)
      }
      return next
    })
  }

  return (
    <>
      {pendingDelete && (
        <DeleteModal
          slug={pendingDelete}
          onConfirm={() => { onDelete(pendingDelete); setPendingDelete(null) }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {pendingRemoveRepo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setPendingRemoveRepo(null)}
        >
          <div
            className="bg-background border border-border rounded-none shadow-lg p-5 w-80 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Remove repository?</span>
              <span className="text-xs text-muted-foreground">
                This will remove{' '}
                <code className="font-mono text-destructive bg-destructive/10 px-1 rounded-none">{pendingRemoveRepo}</code>{' '}
                from the sidebar. You can re-add it in Settings.
              </span>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPendingRemoveRepo(null)}
                className="text-xs px-3 py-1.5 rounded-none border border-border bg-background text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { onRemoveRepo?.(pendingRemoveRepo); setPendingRemoveRepo(null) }}
                className="text-xs px-3 py-1.5 rounded-none bg-destructive hover:bg-destructive/90 text-destructive-foreground font-medium transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1 p-2">
        {entries.length === 0 ? (
          <div className="text-muted-foreground text-xs px-2">
            <p>No plans yet.</p>
            <button
              onClick={() => onNewPlan?.()}
              className="mt-1 text-primary hover:underline"
            >
              Create your first plan →
            </button>
          </div>
        ) : repos && repos.length >= 2 ? (
          // Multi-repo: group by repo with collapsible sections
          <>
            {repos.map((repo) => {
              const repoName = repo.name || repo.path
              const repoEntries = entriesByRepo[repoName] || []
              const activeEntries = repoEntries.filter((e) => e.doc_status !== 'complete')
              const completedEntries = repoEntries.filter((e) => e.doc_status === 'complete')
              const isCollapsed = collapsedRepos.has(repoName)

              return (
                <div key={repoName} className="mb-3 border-l-2 border-primary/30 bg-primary/[0.03] dark:bg-primary/[0.06]">
                  <div className="flex items-center">
                    {onRemoveRepo && (
                      <button
                        onClick={() => setPendingRemoveRepo(repoName)}
                        className="shrink-0 px-1.5 text-muted-foreground/40 hover:text-destructive transition-colors text-xs border-r border-border"
                        title={`Remove ${repoName}`}
                      >
                        ✕
                      </button>
                    )}
                    <button
                      onClick={() => toggleRepo(repoName)}
                      className="flex-1 flex items-center justify-between text-xs font-semibold text-foreground px-2 py-1.5 hover:bg-primary/10 transition-colors"
                    >
                      <span>{repoName}</span>
                      <span className="text-[10px] text-primary">{isCollapsed ? '▶' : '▼'}</span>
                    </button>
                  </div>
                  {!isCollapsed && (
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
                        <div className="mt-2 ml-1 rounded-none bg-background/80">
                          <button
                            onClick={() => setShowCompletedRepos(prev => {
                              const next = new Set(prev)
                              next.has(repoName) ? next.delete(repoName) : next.add(repoName)
                              return next
                            })}
                            className="w-full flex items-center justify-between text-xs font-medium uppercase tracking-wider text-muted-foreground px-2 py-1.5 hover:bg-muted rounded-none transition-colors"
                          >
                            <span>Completed ({completedEntries.length})</span>
                            <span className="text-[10px]">{showCompletedRepos.has(repoName) ? '▼' : '▶'}</span>
                          </button>
                          {showCompletedRepos.has(repoName) && completedEntries.map((e) => (
                            <EntryRow
                              key={e.slug}
                              e={e}
                              selectedSlug={selectedSlug}
                              loading={loading}
                              onSelect={onSelect}
                              onRequestDelete={setPendingDelete}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
            {onManageRepos && (
              <button
                onClick={onManageRepos}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline px-2 mt-2"
                title="Manage repositories"
              >
                + manage repos
              </button>
            )}
          </>
        ) : (
          // Single repo: show IMPLs directly with repo header
          <>
            {repos && repos.length === 1 && (
              <div className="px-2 py-1.5 mb-2 border-b border-border flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {repos[0].name || repos[0].path}
                </span>
                {onManageRepos && (
                  <button
                    onClick={onManageRepos}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline"
                    title="Manage repositories"
                  >
                    add repo
                  </button>
                )}
              </div>
            )}
            {Object.values(entriesByRepo).flat().filter((e) => e.doc_status !== 'complete').map((e) => (
              <EntryRow
                key={e.slug}
                e={e}
                selectedSlug={selectedSlug}
                loading={loading}
                onSelect={onSelect}
                onRequestDelete={setPendingDelete}
              />
            ))}
            {Object.values(entriesByRepo).flat().filter((e) => e.doc_status === 'complete').length > 0 && (
              <div className="mt-2 mx-1 rounded-none bg-background/80">
                <button
                  onClick={() => setShowCompletedRepos(prev => {
                    const next = new Set(prev)
                    next.has('_all') ? next.delete('_all') : next.add('_all')
                    return next
                  })}
                  className="w-full flex items-center justify-between text-xs font-medium uppercase tracking-wider text-muted-foreground px-2 py-1.5 hover:bg-muted rounded-none transition-colors"
                >
                  <span>Completed ({Object.values(entriesByRepo).flat().filter((e) => e.doc_status === 'complete').length})</span>
                  <span className="text-[10px]">{showCompletedRepos.has('_all') ? '▼' : '▶'}</span>
                </button>
                {showCompletedRepos.has('_all') && Object.values(entriesByRepo).flat().filter((e) => e.doc_status === 'complete').map((e) => (
                  <EntryRow
                    key={e.slug}
                    e={e}
                    selectedSlug={selectedSlug}
                    loading={loading}
                    onSelect={onSelect}
                    onRequestDelete={setPendingDelete}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
