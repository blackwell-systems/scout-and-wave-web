import { useState } from 'react'
import { IMPLDocResponse } from '../types'
import ActionButtons from './ActionButtons'
import { Button } from './ui/button'
import OverviewPanel from './review/OverviewPanel'
import FileOwnershipPanel from './review/FileOwnershipPanel'
import WaveStructurePanel from './review/WaveStructurePanel'
import AgentPromptsPanel from './review/AgentPromptsPanel'
import InterfaceContractsPanel from './review/InterfaceContractsPanel'
import ScaffoldsPanel from './review/ScaffoldsPanel'
import DependencyGraphPanel from './review/DependencyGraphPanel'
import KnownIssuesPanel from './review/KnownIssuesPanel'
import PostMergeChecklistPanel from './review/PostMergeChecklistPanel'

interface ReviewScreenProps {
  slug: string
  impl: IMPLDocResponse
  onApprove: () => void
  onReject: () => void
}

type PanelKey = 'overview' | 'file-ownership' | 'wave-structure' | 'agent-prompts' | 'interface-contracts' | 'scaffolds' | 'dependency-graph' | 'known-issues' | 'post-merge-checklist'

const panels: Array<{ key: PanelKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'file-ownership', label: 'File Ownership' },
  { key: 'wave-structure', label: 'Wave Structure' },
  { key: 'agent-prompts', label: 'Agent Prompts' },
  { key: 'interface-contracts', label: 'Interface Contracts' },
  { key: 'scaffolds', label: 'Scaffolds' },
  { key: 'dependency-graph', label: 'Dependency Graph' },
  { key: 'known-issues', label: 'Known Issues' },
  { key: 'post-merge-checklist', label: 'Post-Merge' },
]

export default function ReviewScreen(props: ReviewScreenProps): JSX.Element {
  const { slug, impl, onApprove, onReject } = props
  const isNotSuitable = impl.suitability.verdict === 'NOT SUITABLE'

  const [activePanels, setActivePanels] = useState<Set<PanelKey>>(
    new Set(['overview', 'wave-structure', 'dependency-graph'])
  )

  const togglePanel = (key: PanelKey) => {
    setActivePanels(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Plan Review</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">{slug}</p>
        </div>

        {/* Toggle buttons - grayed out if NOT SUITABLE */}
        <div className={isNotSuitable ? 'opacity-40 pointer-events-none' : ''}>
          <div className="flex flex-wrap gap-2 mb-6">
            {panels.map(panel => (
              <Button
                key={panel.key}
                onClick={() => togglePanel(panel.key)}
                variant="outline"
                size="sm"
                className={`text-xs ${
                  activePanels.has(panel.key)
                    ? 'bg-primary/10 border-primary/30 hover:bg-primary/15'
                    : 'hover:bg-accent'
                }`}
              >
                {panel.label}
              </Button>
            ))}
          </div>

          {/* Active panels stacked vertically */}
          <div className="space-y-6">
            {activePanels.has('overview') && (
              <OverviewPanel impl={impl} />
            )}

            {activePanels.has('file-ownership') && (
              <FileOwnershipPanel impl={impl} />
            )}

            {activePanels.has('wave-structure') && (
              <WaveStructurePanel impl={impl} />
            )}

            {activePanels.has('agent-prompts') && (
              <AgentPromptsPanel agentPrompts={(impl as any).agent_prompts} />
            )}

            {activePanels.has('interface-contracts') && (
              <InterfaceContractsPanel contractsText={(impl as any).interface_contracts_text} />
            )}

            {activePanels.has('scaffolds') && (
              <ScaffoldsPanel scaffoldsDetail={(impl as any).scaffolds_detail} />
            )}

            {activePanels.has('dependency-graph') && (
              <DependencyGraphPanel dependencyGraphText={(impl as any).dependency_graph_text} />
            )}

            {activePanels.has('known-issues') && (
              <KnownIssuesPanel knownIssues={(impl as any).known_issues} />
            )}

            {activePanels.has('post-merge-checklist') && (
              <PostMergeChecklistPanel checklistText={(impl as any).post_merge_checklist_text} />
            )}
          </div>
        </div>

        {/* Action buttons - always interactive, fixed at bottom */}
        <div className="mt-8">
          <ActionButtons onApprove={onApprove} onReject={onReject} />
        </div>
      </div>
    </div>
  )
}
