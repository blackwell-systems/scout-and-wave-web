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
    showPrograms,
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

  return (
    <>
      {showPrograms && programs.length > 0 && (
        <ProgramList
          programs={programs}
          selectedSlug={selectedProgramSlug}
          onSelect={onSelectProgram}
        />
      )}
      <ResumeBanner sessions={interruptedSessions} runningSlugs={runningSlugs} onSelect={onSelectInterrupted ?? onSelect} />
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
    </>
  )
}
