import React from 'react'
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

  if (showPrograms) {
    return (
      <ProgramList
        programs={programs}
        selectedSlug={selectedProgramSlug}
        onSelect={onSelectProgram}
      />
    )
  }

  return (
    <>
      <ResumeBanner sessions={interruptedSessions} onSelect={onSelect} />
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
