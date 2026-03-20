import React, { Suspense } from 'react'
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
              <LazyDependencyGraphPanel dependencyGraphText={(impl as any).dependency_graph_text} {...(executionState ? { executionState } : {})} />
            </Suspense>
          )}
        </div>
      )}

      {/* File Ownership — full width when alone */}
      {activePanels.includes('file-ownership') && (() => {
        const AnyFileOwnershipPanel = FileOwnershipPanel as any
        return <div className="panel-animate"><AnyFileOwnershipPanel impl={impl} repos={repos} onFileClick={onFileClick} /></div>
      })()}

      {/* Interface Contracts — full width */}
      {activePanels.includes('interface-contracts') && (
        <div className="panel-animate"><InterfaceContractsPanel contractsText={(impl as any).interface_contracts_text} /></div>
      )}

      {/* Agent Prompts — full width */}
      {activePanels.includes('agent-prompts') && (
        <Suspense fallback={<PanelFallback />}>
          <div className="panel-animate"><LazyAgentContextPanel impl={impl} slug={slug} /></div>
        </Suspense>
      )}

      {/* Scaffolds — full width, above pre-mortem */}
      {activePanels.includes('scaffolds') && (
        <Suspense fallback={<PanelFallback />}>
          <div className="panel-animate"><LazyScaffoldsPanel scaffoldsDetail={(impl as any).scaffolds_detail} /></div>
        </Suspense>
      )}

      {/* Pre-Mortem — full width */}
      {activePanels.includes('pre-mortem') && (
        <Suspense fallback={<PanelFallback />}>
          <div className="panel-animate"><LazyPreMortemPanel preMortem={impl.pre_mortem} /></div>
        </Suspense>
      )}

      {/* Wiring Declarations — full width */}
      {activePanels.includes('wiring') && (
        <Suspense fallback={<PanelFallback />}>
          <div className="panel-animate">
            <LazyWiringPanel wiring={impl.wiring} />
          </div>
        </Suspense>
      )}

      {/* Reactions Config — full width */}
      {activePanels.includes('reactions') && (
        <Suspense fallback={<PanelFallback />}>
          <div className="panel-animate">
            <LazyReactionsPanel reactions={impl.reactions} />
          </div>
        </Suspense>
      )}

      {/* Known Issues — full width */}
      {activePanels.includes('known-issues') && (
        <Suspense fallback={<PanelFallback />}>
          <div className="panel-animate"><LazyKnownIssuesPanel knownIssues={(impl as any).known_issues} /></div>
        </Suspense>
      )}

      {/* Stub Report — full width */}
      {activePanels.includes('stub-report') && (
        <Suspense fallback={<PanelFallback />}>
          <div className="panel-animate"><LazyStubReportPanel stubReportText={impl.stub_report_text} /></div>
        </Suspense>
      )}

      {/* Post-Merge Checklist — full width */}
      {activePanels.includes('post-merge-checklist') && (
        <Suspense fallback={<PanelFallback />}>
          <div className="panel-animate"><LazyPostMergeChecklistPanel checklistText={(impl as any).post_merge_checklist_text} /></div>
        </Suspense>
      )}

      {/* Amend — full width */}
      {activePanels.includes('amend') && (
        <Suspense fallback={<PanelFallback />}>
          <div className="panel-animate">
            <LazyAmendPanel
              slug={slug}
              waves={impl.waves}
              onAmendComplete={onAmendComplete}
            />
          </div>
        </Suspense>
      )}

      {/* Quality Gates — full width */}
      {activePanels.includes('quality-gates') && (
        <Suspense fallback={<PanelFallback />}>
          <div className="panel-animate"><LazyQualityGatesPanel gatesText={(impl as any).quality_gates_text ?? ''} /></div>
        </Suspense>
      )}

      {/* Project Memory (CONTEXT.md) — full width */}
      {activePanels.includes('context-viewer') && (
        <Suspense fallback={<PanelFallback />}>
          <div className="panel-animate"><LazyContextViewerPanel /></div>
        </Suspense>
      )}
    </div>
  )
}
