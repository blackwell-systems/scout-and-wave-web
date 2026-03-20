import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { IMPLDocResponse, CriticResult } from '../types'
import { listWorktrees, batchDeleteWorktrees, fetchDiskWaveStatus, DiskWaveStatus } from '../api'
import { useExecutionSync, ExecutionSyncState, AgentExecStatus } from '../hooks/useExecutionSync'
import { useGlobalEvents } from '../hooks/useGlobalEvents'
import ActionButtons from './ActionButtons'
import { CriticReviewPanel } from './CriticReviewPanel'
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
import WiringPanel from './review/WiringPanel'
import ReactionsPanel from './review/ReactionsPanel'
import StubReportPanel from './review/StubReportPanel'
import QualityGatesPanel from './review/QualityGatesPanel'
import NotSuitableResearchPanel from './review/NotSuitableResearchPanel'
import FileDiffPanel from './review/FileDiffPanel'
import ContextViewerPanel from './review/ContextViewerPanel'
import WorktreePanel from './WorktreePanel'
import ChatPanel from './ChatPanel'
import ManifestValidation from './ManifestValidation'
import AmendPanel from './AmendPanel'

interface ReviewScreenProps {
  slug: string
  impl: IMPLDocResponse
  onApprove: () => void
  onReject: () => void
  onViewWaves?: () => void
  onRefreshImpl?: (slug: string) => Promise<void>
  repos?: import('../types').RepoEntry[]
  chatModel?: string
  refreshTick?: number
}

type PanelKey = 'reactions' | 'pre-mortem' | 'wiring' | 'stub-report' | 'file-ownership' | 'wave-structure' | 'agent-prompts' | 'interface-contracts' | 'scaffolds' | 'dependency-graph' | 'known-issues' | 'post-merge-checklist' | 'quality-gates' | 'worktrees' | 'context-viewer' | 'validation' | 'amend'

const panels: Array<{ key: PanelKey; label: string; essential?: boolean }> = [
  { key: 'wave-structure',       label: 'Wave Structure',      essential: true },
  { key: 'file-ownership',       label: 'File Ownership',      essential: true },
  { key: 'interface-contracts',  label: 'Interface Contracts', essential: true },
  { key: 'dependency-graph',     label: 'Dependency Graph',    essential: false },
  { key: 'pre-mortem',           label: 'Pre-Mortem',          essential: false },
  { key: 'wiring',               label: 'Wiring',              essential: false },
  { key: 'reactions',            label: 'Reactions',           essential: false },
  { key: 'agent-prompts',        label: 'Agent Prompts',       essential: false },
  { key: 'scaffolds',            label: 'Scaffolds',           essential: false },
  { key: 'quality-gates',        label: 'Quality Gates',       essential: false },
  { key: 'known-issues',         label: 'Known Issues',        essential: false },
  { key: 'context-viewer',       label: 'Project Memory',      essential: false },
  { key: 'stub-report',          label: 'Stub Report',         essential: false },
  { key: 'post-merge-checklist', label: 'Post-Merge',          essential: false },
  { key: 'amend',                label: 'Amend',               essential: false },
]

export default function ReviewScreen(props: ReviewScreenProps): JSX.Element {
  const { slug, impl, onApprove, onReject, onViewWaves, onRefreshImpl, repos, chatModel = 'claude-sonnet-4-6', refreshTick } = props
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
  const [showApproveConfirm, setShowApproveConfirm] = useState(false)
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
    return ['wave-structure', 'file-ownership', 'interface-contracts']
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
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

  // Load disk-based wave status (survives server restarts)
  const [diskStatus, setDiskStatus] = useState<DiskWaveStatus | null>(null)
  useEffect(() => {
    fetchDiskWaveStatus(slug)
      .then(setDiskStatus)
      .catch(() => setDiskStatus(null))
  }, [slug, refreshTick])
  const hasWaveWork = (diskStatus?.agents?.length ?? 0) > 0

  // Fire onRefreshImpl when a new wave merges (detected via disk status waves_merged count).
  // This replaces the former standalone EventSource that listened for wave_complete — the
  // event is already handled by useExecutionSync/useWaveEvents; we just need the refresh.
  const prevMergedCount = useRef<number>(0)
  useEffect(() => {
    const count = diskStatus?.waves_merged?.length ?? 0
    if (count > prevMergedCount.current) {
      prevMergedCount.current = count
      onRefreshImpl?.(slug)
    }
  }, [diskStatus?.waves_merged?.length, slug, onRefreshImpl])

  // Synthesize execution state from disk status when no live SSE
  const effectiveExecutionState = useMemo<ExecutionSyncState | null>(() => {
    if (executionState.isLive && executionState.agents.size > 0) return executionState
    if (!diskStatus || !hasWaveWork) return null
    const agents = new Map<string, AgentExecStatus>()
    const waveCounts = new Map<number, { complete: number; total: number }>()
    for (const da of diskStatus.agents) {
      const status = (da.status === 'complete' || da.status === 'failed') ? da.status : 'pending' as const
      agents.set(`${da.wave}:${da.agent}`, { status, agent: da.agent, wave: da.wave, failureType: da.failure_type })
      const wc = waveCounts.get(da.wave) ?? { complete: 0, total: 0 }
      wc.total++
      if (status === 'complete') wc.complete++
      waveCounts.set(da.wave, wc)
    }
    const waveProgress = new Map<number, { complete: number; total: number }>()
    for (const [w, c] of waveCounts) waveProgress.set(w, c)
    return {
      agents,
      waveProgress,
      scaffoldStatus: diskStatus.scaffold_status === 'committed' ? 'complete' as const : 'idle' as const,
      isLive: false,
    }
  }, [executionState, diskStatus, hasWaveWork])

  // Critic review state — fetched from GET /api/impl/{slug}/critic-review
  const [criticReport, setCriticReport] = useState<CriticResult | null>(null)
  const [criticRunning, setCriticRunning] = useState(false)

  const fetchCriticReport = useCallback(() => {
    fetch(`/api/impl/${encodeURIComponent(slug)}/critic-review`)
      .then(res => {
        if (res.ok) return res.json() as Promise<CriticResult>
        return null
      })
      .then(data => setCriticReport(data))
      .catch(() => setCriticReport(null))
  }, [slug])

  useEffect(() => {
    fetchCriticReport()
  }, [fetchCriticReport])

  const runCriticReview = useCallback(() => {
    setCriticRunning(true)
    fetch(`/api/impl/${encodeURIComponent(slug)}/run-critic`, { method: 'POST' })
      .catch(() => setCriticRunning(false))
    // criticRunning resets to false when critic_review_complete SSE fires
  }, [slug])

  // Listen for critic_review_complete SSE event and refresh
  const handleCriticReviewComplete = useCallback((e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data)
      if (data?.slug === slug) {
        setCriticRunning(false)
        fetchCriticReport()
      }
    } catch {
      // ignore malformed events
    }
  }, [slug, fetchCriticReport])

  useGlobalEvents({ critic_review_complete: handleCriticReviewComplete })

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
  }, [refreshWorktreeCount, refreshTick])

  function handleApproveClick() {
    if (worktreeCount > 0) {
      setWorktreeWarning(true)
    } else {
      setShowApproveConfirm(true)
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
          <h1 className="text-2xl font-bold flex items-center gap-3">
            Plan Review: <span className="font-mono text-primary">{slug}</span>
            {impl.doc_status === 'complete' && (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/50 px-3 py-1 rounded-full">
                <span className="text-green-600 dark:text-green-400">✓</span> Complete
              </span>
            )}
          </h1>
          {involvedRepos.length >= 2 && (
            <p className="text-sm text-muted-foreground mt-2">
              Repositories: <span className="font-mono">{involvedRepos.join(', ')}</span>
            </p>
          )}
        </div>

        {/* First-timer guidance banner */}
        {criticReport === null && !criticRunning && (
          <div className="mb-6 flex items-start gap-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3">
            <span className="text-blue-500 mt-0.5 shrink-0">&#8505;</span>
            <div className="text-sm text-blue-800 dark:text-blue-300">
              <strong>Reviewing for the first time?</strong> Check the wave structure
              (does the agent split make sense?), verify suitability in the Overview,
              then run a Critic Review before approving.
            </div>
          </div>
        )}

        {/* Overview - always visible */}
        <div className={`mb-6 ${isNotSuitable ? 'opacity-40 pointer-events-none' : ''}`}>
          <OverviewPanel impl={impl} />
        </div>

        {/* Critic Review — shown when critic_report exists; button when not yet run */}
        {!isNotSuitable && (
          <div className="mb-6">
            {criticReport ? (
              <CriticReviewPanel result={criticReport} />
            ) : (
              <div className="flex items-center gap-3">
                <button
                  className="flex items-center gap-2 text-sm font-medium px-4 h-9 border border-border bg-background text-foreground hover:bg-muted transition-colors rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={runCriticReview}
                  disabled={criticRunning}
                  title="Verify all agent briefs against the actual codebase before execution."
                >
                  {criticRunning ? 'Running…' : 'Run Critic Review'}
                </button>
                <span className="text-xs text-muted-foreground">
                  {criticRunning
                    ? 'Checking agent briefs against codebase — panel will update when complete.'
                    : 'No critic review yet. Verify agent briefs before approving wave execution.'}
                </span>
              </div>
            )}
          </div>
        )}

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
                  {/* Essential label */}
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 self-center pr-1">
                    Essential
                  </span>
                  {panels.filter(p => p.essential).map(panel => (
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

                  {/* Show all / Show less toggle */}
                  <button
                    onClick={() => setShowAdvanced(v => !v)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border px-3 h-10 transition-colors"
                  >
                    {showAdvanced ? 'Show less' : 'Show all'}
                  </button>

                  {/* Advanced panels — only when showAdvanced */}
                  {showAdvanced && (
                    <>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 self-center px-1">
                        Advanced
                      </span>
                      {panels.filter(p => !p.essential).map(panel => (
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
                    </>
                  )}
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
                    {activePanels.includes('wave-structure') && <WaveStructurePanel impl={impl} {...(effectiveExecutionState ? { executionState: effectiveExecutionState } : {})} />}
                    {activePanels.includes('dependency-graph') && <DependencyGraphPanel dependencyGraphText={(impl as any).dependency_graph_text} {...(effectiveExecutionState ? { executionState: effectiveExecutionState } : {})} />}
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

                {/* Wiring Declarations — full width */}
                {activePanels.includes('wiring') && (
                  <div className="panel-animate">
                    <WiringPanel wiring={impl.wiring} />
                  </div>
                )}

                {/* Reactions Config — full width */}
                {activePanels.includes('reactions') && (
                  <div className="panel-animate">
                    <ReactionsPanel reactions={impl.reactions} />
                  </div>
                )}

                {/* Known Issues — full width */}
                {activePanels.includes('known-issues') && <div className="panel-animate"><KnownIssuesPanel knownIssues={(impl as any).known_issues} /></div>}

                {/* Stub Report — full width */}
                {activePanels.includes('stub-report') && <div className="panel-animate"><StubReportPanel stubReportText={impl.stub_report_text} /></div>}

                {/* Post-Merge Checklist — full width */}
                {activePanels.includes('post-merge-checklist') && <div className="panel-animate"><PostMergeChecklistPanel checklistText={(impl as any).post_merge_checklist_text} /></div>}

                {/* Amend — full width */}
                {activePanels.includes('amend') && (
                  <div className="panel-animate">
                    <AmendPanel
                      slug={props.slug}
                      waves={props.impl.waves}
                      onAmendComplete={() => props.onRefreshImpl?.(props.slug)}
                    />
                  </div>
                )}

                {/* Quality Gates — full width */}
                {activePanels.includes('quality-gates') && (
                  <div className="panel-animate"><QualityGatesPanel gatesText={(impl as any).quality_gates_text ?? ''} /></div>
                )}

                {/* Project Memory (CONTEXT.md) — full width */}
                {activePanels.includes('context-viewer') && (
                  <div className="panel-animate"><ContextViewerPanel /></div>
                )}

              </div>
            </div>
          </>
        )}
      </div>

      {/* Sticky footer — inside scroll container so it respects center column width */}
      {!isNotSuitable && (
        <div className="sticky bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm flex items-stretch justify-center">
          <ActionButtons onApprove={handleApproveClick} onReject={onReject} onRequestChanges={() => setShowRevise(true)} onViewWaves={onViewWaves} hasWaveWork={hasWaveWork} />
          <button
            onClick={() => togglePanel('validation')}
            title="Run manifest validation to check for structural errors in the IMPL doc"
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
            title="View and manage isolated git branches created for this plan's agents"
            className={`flex items-center justify-center gap-2 text-sm font-medium px-6 h-14 transition-all duration-150 border-t-2 ${
              worktreeCount > 0
                ? activePanels.includes('worktrees')
                  ? 'border-t-red-500 text-red-700 dark:text-red-400 bg-red-500/10'
                  : 'border-t-red-500 text-red-600 dark:text-red-400 hover:bg-red-500/10'
                : activePanels.includes('worktrees')
                  ? 'border-t-amber-500 text-amber-700 dark:text-amber-400 bg-amber-500/10'
                  : 'border-t-amber-500/40 text-muted-foreground hover:bg-amber-500/10 hover:text-foreground'
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

      {/* Approve confirmation dialog */}
      {showApproveConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-popover border border-border rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-100 dark:bg-green-950">
                <span className="text-green-600 dark:text-green-400 text-lg">&#9654;</span>
              </div>
              <h3 className="text-base font-semibold text-foreground">Start wave execution?</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              This will launch {impl.waves.reduce((s, w) => s + w.agents.length, 0)} agents across {impl.waves.length} wave{impl.waves.length !== 1 ? 's' : ''} to modify {impl.file_ownership.length} file{impl.file_ownership.length !== 1 ? 's' : ''} in your repository. Claude agents will write code in isolated git branches. This action cannot be easily undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowApproveConfirm(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-border text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { onApprove(); setShowApproveConfirm(false) }}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
              >
                Start Execution
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Worktrees — modal overlay at very top */}
      {activePanels.includes('worktrees') && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-6xl mt-8">
            <WorktreePanel slug={slug} onClose={() => togglePanel('worktrees')} onWorktreeDeleted={refreshWorktreeCount} />
          </div>
        </div>
      )}

      {activePanels.includes('validation') && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl mt-8">
            <ManifestValidation slug={slug} onClose={() => togglePanel('validation')} />
          </div>
        </div>
      )}

    </div>
  )
}
