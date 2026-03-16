import { useState, useEffect, useRef, useCallback } from 'react'
import { IMPLDocResponse } from '../types'
import { listWorktrees, batchDeleteWorktrees } from '../api'
import { useExecutionSync } from '../hooks/useExecutionSync'
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
  { key: 'pre-mortem', label: 'Pre-Mortem' },
  // Implementation Details
  { key: 'interface-contracts', label: 'Interface Contracts' },
  { key: 'scaffolds', label: 'Scaffolds' },
  { key: 'agent-prompts', label: 'Agent Prompts' },
  // Quality
  { key: 'quality-gates', label: 'Quality Gates' },
  { key: 'known-issues', label: 'Known Issues' },
  // Project Context
  { key: 'context-viewer', label: 'Project Memory' },
  // Post-Execution
  { key: 'stub-report', label: 'Stub Report' },
  { key: 'post-merge-checklist', label: 'Post-Merge' },
]

export default function ReviewScreen(props: ReviewScreenProps): JSX.Element {
  const { slug, impl, onApprove, onReject, onRefreshImpl, repos, chatModel = 'claude-sonnet-4-6' } = props
  const isNotSuitable = impl.suitability.verdict === 'NOT SUITABLE'

  const executionState = useExecutionSync(slug)

  // Extract involved repos from file ownership (filter out "system" placeholder)
  const involvedRepos = Array.from(new Set(
    impl.file_ownership
      .map(fo => fo.repo)
      .filter(repo => repo && repo !== 'system')
  )).sort() as string[]

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

  // Worktree presence detection
  const [worktreeCount, setWorktreeCount] = useState(0)
  const [worktreeWarning, setWorktreeWarning] = useState(false)
  const [cleaningWorktrees, setCleaningWorktrees] = useState(false)

  const refreshWorktreeCount = useCallback(() => {
    listWorktrees(slug)
      .then(res => setWorktreeCount(res.worktrees?.length ?? 0))
      .catch(() => setWorktreeCount(0))
  }, [slug])

  useEffect(() => {
    refreshWorktreeCount()
  }, [refreshWorktreeCount])

  function handleApproveClick() {
    if (worktreeCount > 0) {
      setWorktreeWarning(true)
    } else {
      onApprove()
    }
  }

  async function handleCleanAndApprove() {
    setCleaningWorktrees(true)
    try {
      const res = await listWorktrees(slug)
      const branches = res.worktrees.map(w => w.branch)
      if (branches.length > 0) {
        await batchDeleteWorktrees(slug, { branches, force: true })
      }
      setWorktreeCount(0)
      setWorktreeWarning(false)
      onApprove()
    } catch {
      // If cleanup fails, still let them proceed
      setWorktreeWarning(false)
      onApprove()
    } finally {
      setCleaningWorktrees(false)
    }
  }

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
          {involvedRepos.length >= 2 && (
            <p className="text-sm text-muted-foreground mt-2">
              Repositories: <span className="font-mono">{involvedRepos.join(', ')}</span>
            </p>
          )}
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
                    {activePanels.includes('wave-structure') && <WaveStructurePanel impl={impl} {...(executionState.isLive ? { executionState } : {})} />}
                    {activePanels.includes('dependency-graph') && <DependencyGraphPanel dependencyGraphText={(impl as any).dependency_graph_text} {...(executionState.isLive ? { executionState } : {})} />}
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

                {/* Project Memory (CONTEXT.md) — full width */}
                {activePanels.includes('context-viewer') && (
                  <div className="panel-animate"><ContextViewerPanel /></div>
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
          <ActionButtons onApprove={handleApproveClick} onReject={onReject} onRequestChanges={() => setShowRevise(true)} />
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
            onClick={() => { togglePanel('worktrees'); refreshWorktreeCount() }}
            className={`flex items-center justify-center gap-2 text-sm font-medium px-6 h-14 transition-all duration-150 border-t-2 ${
              worktreeCount > 0
                ? activePanels.includes('worktrees')
                  ? 'border-t-red-500 text-red-700 dark:text-red-400 bg-red-500/10'
                  : 'border-t-red-500 text-red-600 dark:text-red-400 hover:bg-red-500/10'
                : activePanels.includes('worktrees')
                  ? 'border-t-slate-500 text-slate-700 dark:text-slate-400 bg-slate-500/10'
                  : 'border-t-slate-500/40 text-muted-foreground hover:bg-slate-500/10 hover:text-foreground'
            }`}
          >
            Worktrees
            {worktreeCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold bg-red-500 text-white">
                {worktreeCount}
              </span>
            )}
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
          <div className="flex-shrink-0 border-l border-border bg-muted flex flex-col" style={{ width: chatWidthPx }}>
            <ChatPanel slug={slug} onClose={() => setShowChat(false)} />
          </div>
        </>
      )}

      {/* Worktree warning dialog */}
      {worktreeWarning && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-popover border border-border rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-red-100 dark:bg-red-950">
                <span className="text-red-600 dark:text-red-400 text-lg">⚠</span>
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">Stale Worktrees Detected</h3>
                <p className="text-sm text-muted-foreground">{worktreeCount} worktree{worktreeCount !== 1 ? 's' : ''} from a previous run</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              Existing worktrees will conflict with new wave execution. Clean them up before proceeding, or cancel to inspect them first.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setWorktreeWarning(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setWorktreeWarning(false); togglePanel('worktrees') }}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors"
              >
                Inspect
              </button>
              <button
                onClick={handleCleanAndApprove}
                disabled={cleaningWorktrees}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {cleaningWorktrees ? 'Cleaning...' : 'Clean & Approve'}
              </button>
            </div>
          </div>
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
