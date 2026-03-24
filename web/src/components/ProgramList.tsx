// ProgramList — left-sidebar list of discovered PROGRAM manifests.
// Collapsible section shown above ImplList with tier/IMPL hierarchy.

import { useState, useCallback, useEffect } from 'react'
import { ChevronDown, Layers } from 'lucide-react'
import type { ProgramDiscovery } from '../types/program'
import type { ProgramStatus, TierStatus, ImplTierStatus } from '../types/program'
import { fetchProgramStatus } from '../programApi'
import { getProgramStateDotClass } from '../lib/statusColors'

const STATE_LABEL: Record<string, string> = {
  COMPLETE:       'Complete',
  TIER_EXECUTING: 'Executing',
  REVIEWED:       'Reviewed',
  SCAFFOLD:       'Scaffold',
  BLOCKED:        'Blocked',
  NOT_SUITABLE:   'Not Suitable',
  PLANNING:       'Planning',
}

const IMPL_DOT: Record<string, string> = {
  complete:      'bg-green-500',
  executing:     'bg-blue-500 animate-pulse shadow-[0_0_6px_rgba(59,130,246,0.7)]',
  'in-progress': 'bg-blue-500 animate-pulse shadow-[0_0_6px_rgba(59,130,246,0.7)]',
  reviewed:      'bg-yellow-400',
  scouting:      'bg-purple-400 animate-pulse',
  blocked:       'bg-red-500',
  'not-suitable':'bg-gray-400',
}

function implDotClass(status: string): string {
  return IMPL_DOT[status] ?? 'bg-gray-400'
}

function implLabel(status: string): string {
  if (status === 'complete') return '✓'
  if (status === 'executing' || status === 'in-progress') return '●'
  if (status === 'blocked') return '✗'
  return '○'
}

interface ProgramListProps {
  programs: ProgramDiscovery[]
  selectedSlug: string | null
  onSelect: (slug: string) => void
  onSelectImpl?: (implSlug: string) => void
}

function TierRow({ tier, onSelectImpl }: { tier: TierStatus; onSelectImpl?: (slug: string) => void }): JSX.Element {
  const implCount = tier.impl_statuses?.length ?? 0
  const completedCount = tier.impl_statuses?.filter((i: ImplTierStatus) => i.status === 'complete').length ?? 0
  const allComplete = implCount > 0 && completedCount === implCount

  return (
    <div className="ml-2 border-l border-border/50 pl-2">
      <div className="flex items-center gap-1.5 py-0.5">
        <span className={`w-1 h-1 rounded-full shrink-0 ${
          allComplete ? 'bg-green-500' : tier.complete ? 'bg-green-500' : 'bg-muted-foreground/30'
        }`} />
        <span className="text-[10px] font-medium text-muted-foreground">
          Tier {tier.number}
        </span>
        {implCount > 0 && (
          <span className="text-[9px] text-muted-foreground/60">
            {completedCount}/{implCount}
          </span>
        )}
      </div>
      {tier.impl_statuses?.map((impl: ImplTierStatus) => (
        <button
          key={impl.slug}
          onClick={(ev) => { ev.stopPropagation(); onSelectImpl?.(impl.slug) }}
          className="w-full flex items-center gap-1.5 pl-2 py-0.5 text-left hover:bg-muted/40 transition-colors rounded-none"
        >
          <span className={`w-1 h-1 rounded-none shrink-0 ${implDotClass(impl.status)}`} />
          <span className={`text-[10px] font-mono truncate ${
            impl.status === 'complete' ? 'text-muted-foreground/50 line-through' : 'text-foreground/80'
          }`}>
            {implLabel(impl.status)} {impl.slug}
          </span>
          {impl.wave_progress && (
            <span className="text-[9px] text-muted-foreground/60 shrink-0 ml-auto">
              {impl.wave_progress}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

function ProgramEntry({
  program,
  isSelected,
  onSelect,
  onSelectImpl,
}: {
  program: ProgramDiscovery
  isSelected: boolean
  onSelect: () => void
  onSelectImpl?: (slug: string) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState<ProgramStatus | null>(null)
  const [loading, setLoading] = useState(false)

  const dotClass = getProgramStateDotClass(program.state)
  const stateLabel = STATE_LABEL[program.state] ?? program.state
  const isComplete = program.state === 'COMPLETE'
  const isExecuting = program.state === 'TIER_EXECUTING'

  const loadStatus = useCallback(async () => {
    if (status || loading) return
    setLoading(true)
    try {
      const s = await fetchProgramStatus(program.slug)
      setStatus(s)
    } catch {
      // silently fail — user can retry
    } finally {
      setLoading(false)
    }
  }, [program.slug, status, loading])

  // Auto-refresh status when executing
  useEffect(() => {
    if (!isExecuting || !expanded) return
    const interval = setInterval(async () => {
      try {
        const s = await fetchProgramStatus(program.slug)
        setStatus(s)
      } catch { /* ignore */ }
    }, 5000)
    return () => clearInterval(interval)
  }, [isExecuting, expanded, program.slug])

  const handleToggle = (ev: React.MouseEvent) => {
    ev.stopPropagation()
    const next = !expanded
    setExpanded(next)
    if (next) loadStatus()
  }

  const completion = status?.completion
  const progressText = completion
    ? `${completion.tiers_complete}/${completion.tiers_total} tiers · ${completion.impls_complete}/${completion.impls_total} IMPLs`
    : null

  return (
    <div className="flex flex-col">
      <div
        className={`group relative flex items-center transition-colors ${
          isSelected
            ? 'bg-violet-100 dark:bg-violet-950/60'
            : 'hover:bg-muted/40'
        }`}
      >
        {/* Expand chevron */}
        <button
          onClick={handleToggle}
          className="shrink-0 p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`} />
        </button>

        {/* Main click area */}
        <button
          onClick={onSelect}
          className="flex-1 text-left py-2 pr-2 flex flex-col gap-0.5 min-w-0"
        >
          <div className="flex items-center gap-1.5">
            <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
            <span className={`text-xs font-medium truncate leading-tight ${
              isComplete ? 'text-muted-foreground/50 line-through' : isSelected ? 'text-violet-900 dark:text-violet-200' : 'text-foreground'
            }`}>
              {program.title || program.slug}
            </span>
          </div>
          <div className="flex items-center gap-1.5 pl-3">
            <span className="text-[10px] text-muted-foreground/70">
              {stateLabel}
            </span>
            {progressText && (
              <>
                <span className="text-[10px] text-muted-foreground/30">·</span>
                <span className="text-[10px] text-muted-foreground/60">
                  {progressText}
                </span>
              </>
            )}
          </div>
        </button>
      </div>

      {/* Expanded tier/IMPL hierarchy */}
      <div
        className="grid transition-[grid-template-rows] duration-[250ms] ease-in-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          {expanded && (
            <div className="pb-1 pl-1">
              {loading && !status && (
                <div className="pl-4 py-1">
                  <div className="animate-pulse h-2 bg-muted rounded-none w-2/3" />
                </div>
              )}
              {status?.tier_statuses?.map((tier) => (
                <TierRow key={tier.number} tier={tier} onSelectImpl={onSelectImpl} />
              ))}
              {status && completion && completion.total_agents > 0 && (
                <div className="pl-4 pt-1">
                  <span className="text-[9px] text-muted-foreground/50">
                    {completion.total_waves} waves · {completion.total_agents} agents
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ProgramList({ programs, selectedSlug, onSelect, onSelectImpl }: ProgramListProps): JSX.Element {
  const [sectionExpanded, setSectionExpanded] = useState(true)
  const [showCompleted, setShowCompleted] = useState(false)

  if (programs.length === 0) return <></>

  const activePrograms = programs.filter(p => p.state !== 'COMPLETE')
  const completedPrograms = programs.filter(p => p.state === 'COMPLETE')

  return (
    <div className="flex flex-col gap-0.5 pt-2 pb-1">
      {/* Section header */}
      <button
        onClick={() => setSectionExpanded(prev => !prev)}
        className="flex items-center gap-1.5 mx-2 px-2 py-1.5 rounded-none bg-primary/[0.08] border border-primary/20 group hover:bg-primary/[0.12] transition-colors"
      >
        <ChevronDown className={`w-3 h-3 text-primary/70 transition-transform duration-200 ${sectionExpanded ? '' : '-rotate-90'}`} />
        <Layers className="w-3 h-3 text-primary/50" />
        <span className="text-[10px] uppercase tracking-wider text-primary/70 font-semibold group-hover:text-primary transition-colors">
          Programs ({programs.length})
        </span>
      </button>

      {sectionExpanded && (
        <>
          {/* Active programs */}
          {activePrograms.map((p) => (
            <ProgramEntry
              key={p.slug}
              program={p}
              isSelected={p.slug === selectedSlug}
              onSelect={() => onSelect(p.slug)}
              onSelectImpl={onSelectImpl}
            />
          ))}

          {/* Completed programs — collapsible */}
          {completedPrograms.length > 0 && (
            <div className="mt-1 rounded-none bg-background/80">
              <button
                onClick={() => setShowCompleted(prev => !prev)}
                className="w-full flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 px-2 py-1 hover:bg-muted/40 rounded-none transition-colors"
              >
                <span>Completed ({completedPrograms.length})</span>
                <span className={`text-[10px] transition-transform duration-200 ${showCompleted ? 'rotate-90' : ''}`}>▶</span>
              </button>
              <div
                className="grid transition-[grid-template-rows] duration-[200ms] ease-in-out"
                style={{ gridTemplateRows: showCompleted ? '1fr' : '0fr' }}
              >
                <div className="overflow-hidden">
                  {showCompleted && completedPrograms.map((p) => (
                    <ProgramEntry
                      key={p.slug}
                      program={p}
                      isSelected={p.slug === selectedSlug}
                      onSelect={() => onSelect(p.slug)}
                      onSelectImpl={onSelectImpl}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
