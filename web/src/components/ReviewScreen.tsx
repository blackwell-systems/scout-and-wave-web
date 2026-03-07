import { useState, useEffect, useRef } from 'react'
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
  onRefreshImpl?: (slug: string) => Promise<void>
}

type PanelKey = 'file-ownership' | 'wave-structure' | 'agent-prompts' | 'interface-contracts' | 'scaffolds' | 'dependency-graph' | 'known-issues' | 'post-merge-checklist'

const panels: Array<{ key: PanelKey; label: string }> = [
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
  const { slug, impl, onApprove, onReject, onRefreshImpl } = props
  const isNotSuitable = impl.suitability.verdict === 'NOT SUITABLE'

  const [activePanels, setActivePanels] = useState<PanelKey[]>(
    ['wave-structure', 'dependency-graph']
  )
  const [isStuck, setIsStuck] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setIsStuck(!entry.isIntersecting),
      { threshold: 0 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const es = new EventSource(`/api/wave/${slug}/events`)
    es.addEventListener('wave_complete', () => {
      onRefreshImpl?.(slug)
    })
    return () => {
      es.close()
    }
  }, [slug, onRefreshImpl])

  const togglePanel = (key: PanelKey) => {
    setActivePanels(prev =>
      prev.includes(key)
        ? prev.filter(k => k !== key)
        : [...prev, key]
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Plan Review</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">{slug}</p>
        </div>

        {/* Overview - always visible */}
        <div className={`mb-6 ${isNotSuitable ? 'opacity-40 pointer-events-none' : ''}`}>
          <OverviewPanel impl={impl} />
        </div>

        {/* Toggle buttons - grayed out if NOT SUITABLE */}
        <div className={isNotSuitable ? 'opacity-40 pointer-events-none' : ''}>
          <div ref={sentinelRef} className="h-px -mt-px" />
          <div
            className={`sticky top-0 z-40 py-3 mb-6 transition-colors duration-200 ${
              isStuck
                ? 'bg-muted/15 backdrop-blur-sm border-b border-border/50'
                : ''
            }`}
            style={isStuck ? { marginLeft: 'calc(-50vw + 50%)', marginRight: 'calc(-50vw + 50%)', paddingLeft: 'calc(50vw - 50% + 1rem)', paddingRight: 'calc(50vw - 50% + 1rem)' } : {}}
          >
            <div className="flex flex-wrap gap-2">
              {panels.map(panel => (
                <Button
                  key={panel.key}
                  onClick={() => togglePanel(panel.key)}
                  variant="outline"
                  size="sm"
                  className={`text-xs ${
                    activePanels.includes(panel.key)
                      ? 'bg-primary/10 border-primary/30 hover:bg-primary/15'
                      : 'hover:bg-accent'
                  }`}
                >
                  {panel.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Active panels in click order */}
          <div className="space-y-6">
            {activePanels.map(key => {
              switch (key) {
                case 'file-ownership':
                  return <FileOwnershipPanel key={key} impl={impl} />
                case 'wave-structure':
                  return <WaveStructurePanel key={key} impl={impl} />
                case 'agent-prompts':
                  return <AgentPromptsPanel key={key} agentPrompts={(impl as any).agent_prompts} />
                case 'interface-contracts':
                  return <InterfaceContractsPanel key={key} contractsText={(impl as any).interface_contracts_text} />
                case 'scaffolds':
                  return <ScaffoldsPanel key={key} scaffoldsDetail={(impl as any).scaffolds_detail} />
                case 'dependency-graph':
                  return <DependencyGraphPanel key={key} dependencyGraphText={(impl as any).dependency_graph_text} />
                case 'known-issues':
                  return <KnownIssuesPanel key={key} knownIssues={(impl as any).known_issues} />
                case 'post-merge-checklist':
                  return <PostMergeChecklistPanel key={key} checklistText={(impl as any).post_merge_checklist_text} />
              }
            })}
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
