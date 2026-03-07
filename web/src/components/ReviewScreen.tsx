import { IMPLDocResponse } from '../types'
import ActionButtons from './ActionButtons'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
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

export default function ReviewScreen(props: ReviewScreenProps): JSX.Element {
  const { slug, impl, onApprove, onReject } = props
  const isNotSuitable = impl.suitability.verdict === 'NOT SUITABLE'

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Plan Review</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">{slug}</p>
        </div>

        {/* Tabbed content - grayed out if NOT SUITABLE */}
        <div className={isNotSuitable ? 'opacity-40 pointer-events-none' : ''}>
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-9 h-auto">
              <TabsTrigger value="overview" className="text-xs px-2 py-2">
                Overview
              </TabsTrigger>
              <TabsTrigger value="file-ownership" className="text-xs px-2 py-2">
                File Ownership
              </TabsTrigger>
              <TabsTrigger value="wave-structure" className="text-xs px-2 py-2">
                Wave Structure
              </TabsTrigger>
              <TabsTrigger value="agent-prompts" className="text-xs px-2 py-2">
                Agent Prompts
              </TabsTrigger>
              <TabsTrigger value="interface-contracts" className="text-xs px-2 py-2">
                Interface Contracts
              </TabsTrigger>
              <TabsTrigger value="scaffolds" className="text-xs px-2 py-2">
                Scaffolds
              </TabsTrigger>
              <TabsTrigger value="dependency-graph" className="text-xs px-2 py-2">
                Dependency Graph
              </TabsTrigger>
              <TabsTrigger value="known-issues" className="text-xs px-2 py-2">
                Known Issues
              </TabsTrigger>
              <TabsTrigger value="post-merge-checklist" className="text-xs px-2 py-2">
                Post-Merge
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6">
              <OverviewPanel impl={impl} />
            </TabsContent>

            <TabsContent value="file-ownership" className="mt-6">
              <FileOwnershipPanel impl={impl} />
            </TabsContent>

            <TabsContent value="wave-structure" className="mt-6">
              <WaveStructurePanel impl={impl} />
            </TabsContent>

            <TabsContent value="agent-prompts" className="mt-6">
              <AgentPromptsPanel agentPrompts={(impl as any).agent_prompts} />
            </TabsContent>

            <TabsContent value="interface-contracts" className="mt-6">
              <InterfaceContractsPanel contractsText={(impl as any).interface_contracts_text} />
            </TabsContent>

            <TabsContent value="scaffolds" className="mt-6">
              <ScaffoldsPanel scaffoldsDetail={(impl as any).scaffolds_detail} />
            </TabsContent>

            <TabsContent value="dependency-graph" className="mt-6">
              <DependencyGraphPanel dependencyGraphText={(impl as any).dependency_graph_text} />
            </TabsContent>

            <TabsContent value="known-issues" className="mt-6">
              <KnownIssuesPanel knownIssues={(impl as any).known_issues} />
            </TabsContent>

            <TabsContent value="post-merge-checklist" className="mt-6">
              <PostMergeChecklistPanel checklistText={(impl as any).post_merge_checklist_text} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Action buttons - always interactive, fixed at bottom */}
        <div className="mt-8">
          <ActionButtons onApprove={onApprove} onReject={onReject} />
        </div>
      </div>
    </div>
  )
}
