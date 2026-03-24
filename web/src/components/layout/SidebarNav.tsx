import { useState } from 'react'
import { ChevronDown, FileText } from 'lucide-react'
import ImplList from '../ImplList'
import ProgramList from '../ProgramList'
import ResumeBanner from '../ResumeBanner'
import type { IMPLListEntry, RepoEntry, InterruptedSession } from '../../types'
import type { ProgramDiscovery } from '../../types/program'

export interface SidebarNavProps {
  showPrograms: boolean
  programs: ProgramDiscovery[]
  selectedProgramSlug: string | null
  onSelectProgram: (slug: string) => void
  interruptedSessions: InterruptedSession[]
  runningSlugs?: Set<string>
  onSelectInterrupted?: (slug: string) => void
  entries: IMPLListEntry[]
  selectedSlug: string | null
  onSelect: (slug: string) => void
  onDelete: (slug: string) => void
  loading: boolean
  repos: RepoEntry[]
  onManageRepos: () => void
  onRemoveRepo: (name: string) => void
  onNewPlan: () => void
}

export function SidebarNav(props: SidebarNavProps): JSX.Element {
  const {
    programs,
    selectedProgramSlug,
    onSelectProgram,
    interruptedSessions,
    runningSlugs,
    onSelectInterrupted,
    entries,
    selectedSlug,
    onSelect,
    onDelete,
    loading,
    repos,
    onManageRepos,
    onRemoveRepo,
    onNewPlan,
  } = props

  const [plansExpanded, setPlansExpanded] = useState(true)

  return (
    <>
      <ResumeBanner sessions={interruptedSessions} runningSlugs={runningSlugs} onSelect={onSelectInterrupted ?? onSelect} />
      {programs.length > 0 && (
        <ProgramList
          programs={programs}
          selectedSlug={selectedProgramSlug}
          onSelect={onSelectProgram}
          onSelectImpl={onSelect}
        />
      )}
      <div className="flex flex-col">
        <button
          onClick={() => setPlansExpanded(prev => !prev)}
          className="flex items-center gap-1.5 mx-2 mt-2 px-2 py-1.5 rounded-none bg-muted/80 border border-border/50 group hover:bg-muted transition-colors"
        >
          <ChevronDown className={`w-3 h-3 text-foreground/50 transition-transform duration-200 ${plansExpanded ? '' : '-rotate-90'}`} />
          <FileText className="w-3 h-3 text-foreground/40" />
          <span className="text-[10px] uppercase tracking-wider text-foreground/60 font-semibold group-hover:text-foreground/80 transition-colors">
            Plans ({entries.length})
          </span>
        </button>
        <div
          className="grid transition-[grid-template-rows] duration-[250ms] ease-in-out"
          style={{ gridTemplateRows: plansExpanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            {plansExpanded && (
              <ImplList
                entries={entries}
                selectedSlug={selectedSlug}
                onSelect={onSelect}
                onDelete={onDelete}
                loading={loading}
                repos={repos}
                onManageRepos={onManageRepos}
                onRemoveRepo={onRemoveRepo}
                onNewPlan={onNewPlan}
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
