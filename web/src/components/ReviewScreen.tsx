import { useState, useEffect, useRef } from 'react'
import { IMPLDocResponse } from '../types'
import ActionButtons from './ActionButtons'
import RevisePanel from './RevisePanel'
import OverviewPanel from './review/OverviewPanel'
import FileOwnershipPanel from './review/FileOwnershipPanel'
import WaveStructurePanel from './review/WaveStructurePanel'
import AgentContextPanel from './review/AgentContextPanel'
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
import WorktreePanel from './WorktreePanel'
import ChatPanel from './ChatPanel'
import ManifestValidation from './ManifestValidation'

interface ReviewScreenProps {
  slug: string
  impl: IMPLDocResponse
  onApprove: () => void
  onReject: () => void
  onRefreshImpl?: (slug: string) => Promise<void>
  repos?: import('../types').RepoEntry[]
  chatModel?: string
}

type PanelKey = 'pre-mortem' | 'stub-report' | 'file-ownership' | 'wave-structure' | 'agent-prompts' | 'interface-contracts' | 'scaffolds' | 'dependency-graph' | 'known-issues' | 'post-merge-checklist' | 'quality-gates' | 'worktrees' | 'context-viewer' | 'validation'

const panels: Array<{ key: PanelKey; label: string }> = [
  // Structure & Plan
  { key: 'wave-structure', label: 'Wave Structure' },
  { key: 'dependency-graph', label: 'Dependency Graph' },
  { key: 'file-ownership', label: 'File Ownership' },
  // Implementation Details
  { key: 'interface-contracts', label: 'Interface Contracts' },
  { key: 'scaffolds', label: 'Scaffolds' },
  { key: 'agent-prompts', label: 'Agent Prompts' },
  // Risk & Quality
  { key: 'pre-mortem', label: 'Pre-Mortem' },
  { key: 'quality-gates', label: 'Quality Gates' },
  { key: 'known-issues', label: 'Known Issues' },
  // Post-Execution
  { key: 'stub-report', label: 'Stub Report' },
  { key: 'post-merge-checklist', label: 'Post-Merge' },
]

export default function ReviewScreen(props: ReviewScreenProps): JSX.Element {
  const { slug, impl, onApprove, onReject, onRefreshImpl, repos, chatModel = 'claude-sonnet-4-6' } = props
  const isNotSuitable = impl.suitability.verdict === 'NOT SUITABLE'

  // Format chat button label based on model
  const getChatButtonLabel = () => {
    const model = chatModel.toLowerCase()
    if (model.includes('claude')) return 'Ask Claude'
    if (model.includes('gpt') || model.includes('openai')) return 'Ask GPT'
    if (model.includes('gemini')) return 'Ask Gemini'
    if (model.includes('llama')) return 'Ask Llama'
    return `Ask ${chatModel.split('-')[0]}`
  }

  const [showRevise, setShowRevise] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [diffTarget, setDiffTarget] = useState<{ agent: string; wave: number; file: string } | null>(null)
  const [chatWidthPx, setChatWidthPx] = useState(420)

  const chatDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const onMove = (mv: MouseEvent) => {
      setChatWidthPx(Math.max(280, Math.min(window.innerWidth - mv.clientX, window.innerWidth * 0.55)))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const [activePanels, setActivePanels] = useState<PanelKey[]>(() => {
    const defaults: PanelKey[] = []
    defaults.push('wave-structure', 'dependency-graph', 'file-ownership')
    if ((impl as any).scaffolds_detail?.length > 0) {
      defaults.push('scaffolds')
    }
    if (impl.pre_mortem) {
      defaults.push('pre-mortem')
    }
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
    <div className="h-full bg-background flex overflow-hidden">
      <div className={`${showChat ? 'flex-1' : 'w-full'} overflow-y-auto`}>
      <div className="max-w-[1800px] mx-auto px-4 py-8 pb-4">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">
            Plan Review: <span className="font-mono text-primary">{slug}</span>
          </h1>
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
                    <button
                      key={panel.key}
                      onClick={() => togglePanel(panel.key)}
                      className={`flex items-center justify-center text-sm font-medium px-4 h-10 transition-colors border ${
                        activePanels.includes(panel.key)
                          ? 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/15'
                          : 'border-border bg-background text-foreground hover:bg-muted'
                      }`}
                    >
                      {panel.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Active panels — fixed layout grid */}
              <div className="space-y-6">
                {/* Wave Structure + Dependency Graph pair */}
                {(activePanels.includes('wave-structure') || activePanels.includes('dependency-graph')) && (
                  <div className={`panel-animate grid gap-6 ${
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
                  return <div className="panel-animate"><AnyFileOwnershipPanel impl={impl} repos={repos} onFileClick={(agent: string, wave: number, file: string) => setDiffTarget({ agent, wave, file })} /></div>
                })()}

                {/* Interface Contracts — full width */}
                {activePanels.includes('interface-contracts') && (
                  <div className="panel-animate"><InterfaceContractsPanel contractsText={(impl as any).interface_contracts_text} /></div>
                )}

                {/* Agent Prompts — full width */}
                {activePanels.includes('agent-prompts') && (
                  <div className="panel-animate"><AgentContextPanel impl={impl} slug={slug} /></div>
                )}

                {/* Scaffolds — full width, above pre-mortem */}
                {activePanels.includes('scaffolds') && (
                  <div className="panel-animate"><ScaffoldsPanel scaffoldsDetail={(impl as any).scaffolds_detail} /></div>
                )}

                {/* Pre-Mortem — full width */}
                {activePanels.includes('pre-mortem') && <div className="panel-animate"><PreMortemPanel preMortem={impl.pre_mortem} /></div>}

                {/* Known Issues — full width */}
                {activePanels.includes('known-issues') && <div className="panel-animate"><KnownIssuesPanel knownIssues={(impl as any).known_issues} /></div>}

                {/* Stub Report — full width */}
                {activePanels.includes('stub-report') && <div className="panel-animate"><StubReportPanel stubReportText={impl.stub_report_text} /></div>}

                {/* Post-Merge Checklist — full width */}
                {activePanels.includes('post-merge-checklist') && <div className="panel-animate"><PostMergeChecklistPanel checklistText={(impl as any).post_merge_checklist_text} /></div>}

                {/* Quality Gates — full width */}
                {activePanels.includes('quality-gates') && (
                  <div className="panel-animate"><QualityGatesPanel gatesText={(impl as any).quality_gates_text ?? ''} /></div>
                )}

                {/* Validation — full width */}
                {activePanels.includes('validation') && (
                  <div className="panel-animate"><ManifestValidation slug={slug} /></div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Sticky footer — inside scroll container so it respects center column width */}
      {!isNotSuitable && (
        <div className="sticky bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm flex items-stretch justify-center">
          <ActionButtons onApprove={onApprove} onReject={onReject} onRequestChanges={() => setShowRevise(true)} />
          <button
            onClick={() => togglePanel('validation')}
            className={`flex items-center justify-center text-sm font-medium px-6 h-14 transition-all duration-150 border-t-2 ${
              activePanels.includes('validation')
                ? 'border-t-blue-500 text-blue-700 dark:text-blue-400 bg-blue-500/10'
                : 'border-t-blue-500/40 text-muted-foreground hover:bg-blue-500/10 hover:text-foreground'
            }`}
          >
            Validate
          </button>
          <button
            onClick={() => togglePanel('worktrees')}
            className={`flex items-center justify-center text-sm font-medium px-6 h-14 transition-all duration-150 border-t-2 ${
              activePanels.includes('worktrees')
                ? 'border-t-slate-500 text-slate-700 dark:text-slate-400 bg-slate-500/10'
                : 'border-t-slate-500/40 text-muted-foreground hover:bg-slate-500/10 hover:text-foreground'
            }`}
          >
            Worktrees
          </button>
          <button
            onClick={() => togglePanel('context-viewer')}
            className={`flex items-center justify-center text-sm font-medium px-6 h-14 transition-all duration-150 border-t-2 ${
              activePanels.includes('context-viewer')
                ? 'border-t-teal-500 text-teal-700 dark:text-teal-400 bg-teal-500/10'
                : 'border-t-teal-500/40 text-muted-foreground hover:bg-teal-500/10 hover:text-foreground'
            }`}
          >
            Project Memory
          </button>
          <button
            onClick={() => setShowChat(v => !v)}
            className={`flex items-center justify-center text-sm font-semibold px-8 h-14 transition-all duration-150 border-t-2 ${
              showChat
                ? 'border-t-violet-500 text-violet-700 dark:text-violet-400 bg-violet-500/20'
                : 'border-t-violet-500/40 text-violet-600 dark:text-violet-400 bg-violet-500/5 hover:bg-violet-500/10 hover:text-violet-700 dark:hover:text-violet-300'
            }`}
          >
            {getChatButtonLabel()}
          </button>
        </div>
      )}
      </div>

      {/* Chat Panel — right sidebar */}
      {showChat && (
        <>
          <div
            onMouseDown={chatDividerMouseDown}
            style={{ width: '4px', flexShrink: 0, alignSelf: 'stretch' }}
            className="cursor-col-resize select-none bg-border hover:bg-primary/30 transition-colors"
          />
          <div className="flex-shrink-0 border-l border-gray-200 dark:border-gray-700 flex flex-col" style={{ width: chatWidthPx }}>
            <ChatPanel slug={slug} onClose={() => setShowChat(false)} />
          </div>
        </>
      )}

      {/* Context Viewer — modal overlay */}
      {activePanels.includes('context-viewer') && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <ContextViewerPanel onClose={() => togglePanel('context-viewer')} />
        </div>
      )}

      {/* Worktrees — modal overlay at very top */}
      {activePanels.includes('worktrees') && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-6xl mt-8">
            <WorktreePanel slug={slug} onClose={() => togglePanel('worktrees')} />
          </div>
        </div>
      )}

    </div>
  )
}
