import React, { Suspense, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { IMPLDocResponse } from '../../types'
import { ExecutionSyncState } from '../../hooks/useExecutionSync'
import FileOwnershipPanel from './FileOwnershipPanel'
import InterfaceContractsPanel from './InterfaceContractsPanel'

// Lazy-loaded panels (non-essential, not shown by default)
const LazyWaveStructurePanel = React.lazy(() => import('./WaveStructurePanel'))
const LazyDependencyGraphPanel = React.lazy(() => import('./DependencyGraphPanel'))
const LazyAgentContextPanel = React.lazy(() => import('./AgentContextPanel'))
const LazyScaffoldsPanel = React.lazy(() => import('./ScaffoldsPanel'))
const LazyPreMortemPanel = React.lazy(() => import('./PreMortemPanel'))
const LazyWiringPanel = React.lazy(() => import('./WiringPanel'))
const LazyReactionsPanel = React.lazy(() => import('./ReactionsPanel'))
const LazyKnownIssuesPanel = React.lazy(() => import('./KnownIssuesPanel'))
const LazyStubReportPanel = React.lazy(() => import('./StubReportPanel'))
const LazyPostMergeChecklistPanel = React.lazy(() => import('./PostMergeChecklistPanel'))
const LazyQualityGatesPanel = React.lazy(() => import('./QualityGatesPanel'))
const LazyContextViewerPanel = React.lazy(() => import('./ContextViewerPanel'))
const LazyAmendPanel = React.lazy(() => import('../AmendPanel'))

function PanelFallback() {
  return <div className="animate-pulse h-32 bg-muted rounded" />
}

function CollapsibleSection({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="panel-animate border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-sm font-medium text-foreground"
      >
        {title}
        <ChevronDown size={16} className={`text-primary/70 dark:text-primary/60 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 py-3">{children}</div>}
    </div>
  )
}

type PanelKey = 'reactions' | 'pre-mortem' | 'wiring' | 'stub-report' | 'file-ownership' | 'wave-structure' | 'agent-prompts' | 'interface-contracts' | 'scaffolds' | 'dependency-graph' | 'known-issues' | 'post-merge-checklist' | 'quality-gates' | 'worktrees' | 'context-viewer' | 'validation' | 'amend'

export interface ReviewLayoutProps {
  activePanels: PanelKey[]
  impl: IMPLDocResponse
  slug: string
  executionState?: ExecutionSyncState | null
  repos?: import('../../types').RepoEntry[]
  onFileClick?: (agent: string, wave: number, file: string) => void
  onAmendComplete?: () => void
}

export function ReviewLayout(props: ReviewLayoutProps): JSX.Element {
  const { activePanels, impl, slug, executionState, repos, onFileClick, onAmendComplete } = props

  return (
    <div className="space-y-6">
      {/* Wave Structure + Dependency Graph pair */}
      {(activePanels.includes('wave-structure') || activePanels.includes('dependency-graph')) && (
        <div className={`panel-animate grid gap-6 ${
          activePanels.includes('wave-structure') && activePanels.includes('dependency-graph')
            ? 'grid-cols-1 md:grid-cols-2'
            : 'grid-cols-1'
        }`}>
          {activePanels.includes('wave-structure') && (
            <Suspense fallback={<PanelFallback />}>
              <LazyWaveStructurePanel impl={impl} {...(executionState ? { executionState } : {})} />
            </Suspense>
          )}
          {activePanels.includes('dependency-graph') && (
            <Suspense fallback={<PanelFallback />}>
              <LazyDependencyGraphPanel dependencyGraphText={(impl as any).dependency_graph_text} programSlug={(impl as any).program_slug} programTitle={(impl as any).program_title} programTier={(impl as any).program_tier} programTiersTotal={(impl as any).program_tiers_total} {...(executionState ? { executionState } : {})} />
            </Suspense>
          )}
        </div>
      )}

      {activePanels.includes('file-ownership') && (() => {
        const AnyFileOwnershipPanel = FileOwnershipPanel as any
        return <CollapsibleSection title="File Ownership"><AnyFileOwnershipPanel impl={impl} repos={repos} onFileClick={onFileClick} /></CollapsibleSection>
      })()}

      {activePanels.includes('interface-contracts') && (
        <CollapsibleSection title="Interface Contracts"><InterfaceContractsPanel contractsText={(impl as any).interface_contracts_text} /></CollapsibleSection>
      )}

      {activePanels.includes('agent-prompts') && (
        <Suspense fallback={<PanelFallback />}>
          <CollapsibleSection title="Agent Prompts"><LazyAgentContextPanel impl={impl} slug={slug} /></CollapsibleSection>
        </Suspense>
      )}

      {activePanels.includes('scaffolds') && (
        <Suspense fallback={<PanelFallback />}>
          <CollapsibleSection title="Scaffolds"><LazyScaffoldsPanel scaffoldsDetail={(impl as any).scaffolds_detail} /></CollapsibleSection>
        </Suspense>
      )}

      {activePanels.includes('pre-mortem') && (
        <Suspense fallback={<PanelFallback />}>
          <CollapsibleSection title="Pre-Mortem"><LazyPreMortemPanel preMortem={impl.pre_mortem} /></CollapsibleSection>
        </Suspense>
      )}

      {activePanels.includes('wiring') && (
        <Suspense fallback={<PanelFallback />}>
          <CollapsibleSection title="Wiring"><LazyWiringPanel wiring={impl.wiring} /></CollapsibleSection>
        </Suspense>
      )}

      {activePanels.includes('reactions') && (
        <Suspense fallback={<PanelFallback />}>
          <CollapsibleSection title="Reactions"><LazyReactionsPanel reactions={impl.reactions} /></CollapsibleSection>
        </Suspense>
      )}

      {activePanels.includes('known-issues') && (
        <Suspense fallback={<PanelFallback />}>
          <CollapsibleSection title="Known Issues"><LazyKnownIssuesPanel knownIssues={(impl as any).known_issues} /></CollapsibleSection>
        </Suspense>
      )}

      {activePanels.includes('stub-report') && (
        <Suspense fallback={<PanelFallback />}>
          <CollapsibleSection title="Stub Report"><LazyStubReportPanel stubReportText={impl.stub_report_text} /></CollapsibleSection>
        </Suspense>
      )}

      {activePanels.includes('post-merge-checklist') && (
        <Suspense fallback={<PanelFallback />}>
          <CollapsibleSection title="Post-Merge Checklist"><LazyPostMergeChecklistPanel checklistText={(impl as any).post_merge_checklist_text} /></CollapsibleSection>
        </Suspense>
      )}

      {activePanels.includes('amend') && (
        <Suspense fallback={<PanelFallback />}>
          <CollapsibleSection title="Amend">
            <LazyAmendPanel slug={slug} waves={impl.waves} onAmendComplete={onAmendComplete} />
          </CollapsibleSection>
        </Suspense>
      )}

      {activePanels.includes('quality-gates') && (
        <Suspense fallback={<PanelFallback />}>
          <CollapsibleSection title="Quality Gates"><LazyQualityGatesPanel gatesText={(impl as any).quality_gates_text ?? ''} /></CollapsibleSection>
        </Suspense>
      )}

      {activePanels.includes('context-viewer') && (
        <Suspense fallback={<PanelFallback />}>
          <CollapsibleSection title="Project Memory"><LazyContextViewerPanel /></CollapsibleSection>
        </Suspense>
      )}
    </div>
  )
}
