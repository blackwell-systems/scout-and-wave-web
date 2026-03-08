import { useState, useEffect, useRef } from 'react'
import { IMPLDocResponse } from '../types'
import ActionButtons from './ActionButtons'
import RevisePanel from './RevisePanel'
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
import PreMortemPanel from './review/PreMortemPanel'
import StubReportPanel from './review/StubReportPanel'
import QualityGatesPanel from './review/QualityGatesPanel'
import NotSuitableResearchPanel from './review/NotSuitableResearchPanel'
import FileDiffPanel from './review/FileDiffPanel'
import ContextViewerPanel from './review/ContextViewerPanel'
import ChatPanel from './ChatPanel'

interface ReviewScreenProps {
  slug: string
  impl: IMPLDocResponse
  onApprove: () => void
  onReject: () => void
  onRefreshImpl?: (slug: string) => Promise<void>
}

type PanelKey = 'pre-mortem' | 'stub-report' | 'file-ownership' | 'wave-structure' | 'agent-prompts' | 'interface-contracts' | 'scaffolds' | 'dependency-graph' | 'known-issues' | 'post-merge-checklist' | 'quality-gates' | 'context-viewer'

const panels: Array<{ key: PanelKey; label: string }> = [
  { key: 'pre-mortem', label: 'Pre-Mortem' },
  { key: 'stub-report', label: 'Stub Report' },
  { key: 'file-ownership', label: 'File Ownership' },
  { key: 'wave-structure', label: 'Wave Structure' },
  { key: 'agent-prompts', label: 'Agent Prompts' },
  { key: 'interface-contracts', label: 'Interface Contracts' },
  { key: 'scaffolds', label: 'Scaffolds' },
  { key: 'dependency-graph', label: 'Dependency Graph' },
  { key: 'known-issues', label: 'Known Issues' },
  { key: 'post-merge-checklist', label: 'Post-Merge' },
  { key: 'quality-gates', label: 'Quality Gates' },
  { key: 'context-viewer', label: 'Project Memory' },
]

export default function ReviewScreen(props: ReviewScreenProps): JSX.Element {
  const { slug, impl, onApprove, onReject, onRefreshImpl } = props
  const isNotSuitable = impl.suitability.verdict === 'NOT SUITABLE'

  const [showRevise, setShowRevise] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [diffTarget, setDiffTarget] = useState<{ agent: string; wave: number; file: string } | null>(null)
  const [activePanels, setActivePanels] = useState<PanelKey[]>(() => {
    const defaults: PanelKey[] = []
    if (impl.pre_mortem) {
      defaults.push('pre-mortem')
    }
    defaults.push('wave-structure', 'dependency-graph', 'file-ownership')
    return defaults
  })
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

  if (showRevise) {
    return (
      <RevisePanel
        slug={slug}
        onBack={() => setShowRevise(false)}
        onSaved={() => { onRefreshImpl?.(slug); setShowRevise(false) }}
      />
    )
  }

  if (diffTarget !== null) {
    return (
      <FileDiffPanel
        slug={slug}
        agent={diffTarget.agent}
        wave={diffTarget.wave}
        file={diffTarget.file}
        onBack={() => setDiffTarget(null)}
      />
    )
  }

  return (
    <div className="h-full bg-background">
      <div className="max-w-[1600px] mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Plan Review</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">{slug}</p>
        </div>

        {/* Overview - always visible */}
        <div className={`mb-6 ${isNotSuitable ? 'opacity-40 pointer-events-none' : ''}`}>
          <OverviewPanel impl={impl} />
        </div>

        {/* NOT SUITABLE: show research panel, hide toggles and action buttons */}
        {isNotSuitable ? (
          <NotSuitableResearchPanel impl={impl} onArchive={onReject} />
        ) : (
          <>
            {/* Toggle buttons */}
            <div>
              <div ref={sentinelRef} className="h-px -mt-px" />
              <div
                className={`sticky top-0 z-40 py-3 mb-6 transition-colors duration-200 ${
                  isStuck ? 'bg-muted/15 backdrop-blur-sm border-b border-border/50' : ''
                }`}
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

              {/* Active panels — fixed layout grid */}
              <div className="space-y-6">
                {/* Wave Structure + Dependency Graph pair */}
                {(activePanels.includes('wave-structure') || activePanels.includes('dependency-graph')) && (
                  <div className={`grid gap-6 ${
                    activePanels.includes('wave-structure') && activePanels.includes('dependency-graph')
                      ? 'grid-cols-1 md:grid-cols-2'
                      : 'grid-cols-1'
                  }`}>
                    {activePanels.includes('wave-structure') && <WaveStructurePanel impl={impl} />}
                    {activePanels.includes('dependency-graph') && <DependencyGraphPanel dependencyGraphText={(impl as any).dependency_graph_text} />}
                  </div>
                )}

                {/* File Ownership — full width when alone */}
                {/* TODO: onFileClick wired here; FileOwnershipPanel does not yet declare this prop — will activate after Wave 1 merge */}
                {activePanels.includes('file-ownership') && (() => {
                  const AnyFileOwnershipPanel = FileOwnershipPanel as any
                  return <AnyFileOwnershipPanel impl={impl} onFileClick={(agent: string, wave: number, file: string) => setDiffTarget({ agent, wave, file })} />
                })()}

                {/* Interface Contracts — full width */}
                {activePanels.includes('interface-contracts') && (
                  <InterfaceContractsPanel contractsText={(impl as any).interface_contracts_text} />
                )}

                {/* Agent Prompts + Scaffolds pair */}
                {(activePanels.includes('agent-prompts') || activePanels.includes('scaffolds')) && (
                  <div className={`grid gap-6 ${
                    activePanels.includes('agent-prompts') && activePanels.includes('scaffolds')
                      ? 'grid-cols-1 md:grid-cols-2'
                      : 'grid-cols-1'
                  }`}>
                    {activePanels.includes('agent-prompts') && <AgentPromptsPanel agentPrompts={(impl as any).agent_prompts} />}
                    {activePanels.includes('scaffolds') && <ScaffoldsPanel scaffoldsDetail={(impl as any).scaffolds_detail} />}
                  </div>
                )}

                {/* Pre-Mortem — full width */}
                {activePanels.includes('pre-mortem') && <PreMortemPanel preMortem={impl.pre_mortem} />}

                {/* Known Issues — full width */}
                {activePanels.includes('known-issues') && <KnownIssuesPanel knownIssues={(impl as any).known_issues} />}

                {/* Stub Report — full width */}
                {activePanels.includes('stub-report') && <StubReportPanel stubReportText={impl.stub_report_text} />}

                {/* Post-Merge Checklist — full width */}
                {activePanels.includes('post-merge-checklist') && <PostMergeChecklistPanel checklistText={(impl as any).post_merge_checklist_text} />}

                {/* Quality Gates — full width */}
                {activePanels.includes('quality-gates') && (
                  <QualityGatesPanel gatesText={(impl as any).quality_gates_text ?? ''} />
                )}
              </div>
            </div>

            {/* Action buttons - always interactive, fixed at bottom */}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ActionButtons onApprove={onApprove} onReject={onReject} onRequestChanges={() => setShowRevise(true)} />
              <button onClick={() => setShowChat(true)} className="text-sm border rounded px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800">Ask Claude</button>
            </div>
          </>
        )}
      </div>

      {/* Chat Panel — modal overlay */}
      {showChat && <ChatPanel slug={slug} onClose={() => setShowChat(false)} />}

      {/* Context Viewer — modal overlay */}
      {activePanels.includes('context-viewer') && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <ContextViewerPanel onClose={() => togglePanel('context-viewer')} />
        </div>
      )}
    </div>
  )
}
