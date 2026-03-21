import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { IMPLDocResponse } from '../types'
import { useCriticState } from '../hooks/useCriticState'
import { listWorktrees, batchDeleteWorktrees, fetchDiskWaveStatus, DiskWaveStatus } from '../api'
import { useExecutionSync, ExecutionSyncState, AgentExecStatus } from '../hooks/useExecutionSync'
import { useGlobalEvents } from '../hooks/useGlobalEvents'
import ActionButtons from './ActionButtons'
import { CriticReviewPanel } from './CriticReviewPanel'
import { CriticOutputPanel } from './CriticOutputPanel'
import RevisePanel from './RevisePanel'
import OverviewPanel from './review/OverviewPanel'
import NotSuitableResearchPanel from './review/NotSuitableResearchPanel'
import FileDiffPanel from './review/FileDiffPanel'
import { ReviewLayout } from './review/ReviewLayout'
import { Tooltip } from './ui/tooltip'
import WorktreePanel from './WorktreePanel'
import ChatPanel from './ChatPanel'
import ManifestValidation from './ManifestValidation'

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
  waveBoardExpanded?: boolean
}

type PanelKey = 'reactions' | 'pre-mortem' | 'wiring' | 'stub-report' | 'file-ownership' | 'wave-structure' | 'agent-prompts' | 'interface-contracts' | 'scaffolds' | 'dependency-graph' | 'known-issues' | 'post-merge-checklist' | 'quality-gates' | 'worktrees' | 'context-viewer' | 'validation' | 'amend'

const panelTooltips: Record<PanelKey, string> = {
  'wave-structure': 'Sequential execution phases with parallel agents. Wave N+1 depends on Wave N completing (I3). Shows dependency relationships.',
  'dependency-graph': 'Visualizes which packages and modules depend on each other. Helps verify the Scout chose sensible agent boundaries.',
  'file-ownership': 'Shows which agent owns which files. No two agents in the same wave may modify the same file (I1 invariant). This prevents merge conflicts.',
  'interface-contracts': 'Shared types and function signatures defined before parallel work starts (I2 invariant). Ensures agents can integrate without runtime coordination.',
  'pre-mortem': 'Risk assessment performed by the Scout. Identifies likely failure modes, estimated complexity, and mitigation strategies for each wave.',
  'wiring': 'Integration points where one agent\'s output must be called from another file (E35). Tracked to ensure nothing is left unconnected after merge.',
  'reactions': 'Customized failure-handling rules for this IMPL (E19.1). Overrides default retry/escalation behavior per failure type (transient, fixable, needs_replan).',
  'agent-prompts': 'The full 9-field prompt each agent receives, including task description, file ownership, interface contracts, and verification gates.',
  'scaffolds': 'Type definition files created before Wave 1 launches (I2). Ensures all agents reference the same shared types and interfaces.',
  'quality-gates': 'Build, lint, test, and custom checks that must pass after each wave merges (E21). Failures block the next wave from starting.',
  'known-issues': 'Issues the Scout identified during analysis that may affect implementation but don\'t block execution.',
  'context-viewer': 'Project-level memory (CONTEXT.md) tracking completed features, architectural decisions, and established interfaces across all IMPLs.',
  'stub-report': 'Post-wave scan for TODO/FIXME/stub markers left by agents (E20). Informational — helps catch incomplete implementations before the next wave.',
  'post-merge-checklist': 'Manual verification steps to perform after all waves complete. Covers integration testing, deployment checks, and documentation updates.',
  'amend': 'Modify the IMPL doc mid-execution: add waves, redirect agents, or extend scope without starting over (E36).',
  'worktrees': 'Isolated git branches created for each agent. View active worktrees, inspect their status, or clean up stale branches.',
  'validation': 'Run structural validation on the IMPL doc (E16). Checks required sections, agent ID formats, file ownership conflicts, and gate definitions.',
}

const panels: Array<{ key: PanelKey; label: string; essential?: boolean }> = [
  { key: 'wave-structure',       label: 'Wave Structure',      essential: true },
  { key: 'dependency-graph',     label: 'Dependency Graph',    essential: false },
  { key: 'file-ownership',       label: 'File Ownership',      essential: true },
  { key: 'scaffolds',            label: 'Scaffolds',           essential: false },
  { key: 'interface-contracts',  label: 'Interface Contracts', essential: true },
  { key: 'pre-mortem',           label: 'Pre-Mortem',          essential: false },
  { key: 'wiring',               label: 'Wiring',              essential: false },
  { key: 'reactions',            label: 'Reactions',           essential: false },
  { key: 'agent-prompts',        label: 'Agent Prompts',       essential: false },
  { key: 'quality-gates',        label: 'Quality Gates',       essential: false },
  { key: 'known-issues',         label: 'Known Issues',        essential: false },
  { key: 'context-viewer',       label: 'Project Memory',      essential: false },
  { key: 'stub-report',          label: 'Stub Report',         essential: false },
  { key: 'post-merge-checklist', label: 'Post-Merge',          essential: false },
  { key: 'amend',                label: 'Amend',               essential: false },
]

export default function ReviewScreen(props: ReviewScreenProps): JSX.Element {
  const { slug, impl, onApprove, onReject, onViewWaves, onRefreshImpl, repos, chatModel = 'claude-sonnet-4-6', refreshTick, waveBoardExpanded } = props
  const isNotSuitable = impl.suitability.verdict === 'NOT SUITABLE'

  const executionState = useExecutionSync(slug)

  // Extract involved repos from file ownership (filter out "system" placeholder)
  const involvedRepos = useMemo(() =>
    Array.from(new Set(
      impl.file_ownership
        .map(fo => fo.repo)
        .filter(repo => repo && repo !== 'system')
    )).sort() as string[],
    [impl.file_ownership]
  )

  // Format chat button label based on model
  const getChatButtonLabel = useMemo(() => {
    const model = chatModel.toLowerCase()
    if (model.includes('claude')) return 'Ask Claude'
    if (model.includes('gpt') || model.includes('openai')) return 'Ask GPT'
    if (model.includes('gemini')) return 'Ask Gemini'
    if (model.includes('llama')) return 'Ask Llama'
    return `Ask ${chatModel.split('-')[0]}`
  }, [chatModel])

  const [showRevise, setShowRevise] = useState(false)
  const [showApproveConfirm, setShowApproveConfirm] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [diffTarget, setDiffTarget] = useState<{ agent: string; wave: number; file: string } | null>(null)
  const [chatWidthPx, setChatWidthPx] = useState(420)

  const chatDividerMouseDown = useCallback((e: React.MouseEvent) => {
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
  }, [])

  const [activePanels, setActivePanels] = useState<PanelKey[]>(() => {
    const defaults: PanelKey[] = ['wave-structure', 'dependency-graph', 'file-ownership']
    if ((impl as any).scaffolds_detail?.length > 0) defaults.push('scaffolds')
    if ((impl as any).interface_contracts_text?.trim()) defaults.push('interface-contracts')
    if (impl.wiring?.length) defaults.push('wiring')
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

  // Critic gate — shared hook handles fetch, run, SSE, threshold detection
  const {
    needsCritic, criticReport, criticRunning, criticOutput, criticError,
    runCritic: handleRunCritic, applyCriticFix: handleApplyCriticFix,
    autoFixAll: handleAutoFixAll, autoFixRunning
  } = useCriticState(slug, impl)
  const [showCriticEditor, setShowCriticEditor] = useState(false)

  const handleImplUpdated = useCallback((e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data)
      if (data?.slug === slug) onRefreshImpl?.(slug)
    } catch { /* ignore malformed events */ }
  }, [slug, onRefreshImpl])

  useGlobalEvents({ impl_updated: handleImplUpdated })

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

        {/* Guidance banner */}
        <div className="mb-6 flex items-start gap-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3">
          <span className="text-blue-500 mt-0.5 shrink-0">&#8505;</span>
          <div className="text-sm text-blue-800 dark:text-blue-300">
            <strong>Review checklist:</strong> Check suitability in Overview,
            verify wave structure and file ownership make sense,
            then approve to launch agents.
          </div>
        </div>

        {/* Overview - always visible */}
        <div className={`mb-6 ${isNotSuitable ? 'opacity-40 pointer-events-none' : ''}`}>
          <OverviewPanel impl={impl} />
        </div>

        {/* Critic live output — shown while running */}
        {!isNotSuitable && (criticRunning || criticOutput) && !criticReport && (
          <div className="mb-6">
            <CriticOutputPanel output={criticOutput} running={criticRunning} error={criticError} />
          </div>
        )}
        {!isNotSuitable && criticError && !criticRunning && (
          <div className="mb-6 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-none px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-red-800 dark:text-red-300">Critic review failed: {criticError}</span>
            <button onClick={handleRunCritic} className="text-xs font-medium px-3 py-1.5 rounded-none border border-red-400 dark:border-red-600 text-red-800 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors">
              Retry
            </button>
          </div>
        )}

        {/* Critic review — display only, shown when report exists */}
        {!isNotSuitable && criticReport && (
          <div className="mb-6">
            <CriticReviewPanel
                result={criticReport}
                onApplyFix={handleApplyCriticFix}
                onRerunCritic={handleRunCritic}
                criticRunning={criticRunning}
                onAutoFixAll={handleAutoFixAll}
                autoFixRunning={autoFixRunning}
                slug={slug}
                showEditor={showCriticEditor}
                onToggleEditor={() => setShowCriticEditor(prev => !prev)}
            />
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
                      <Tooltip content={panelTooltips[panel.key]} position="bottom">
                        <span>{panel.label}</span>
                      </Tooltip>
                    </button>
                  ))}
                </div>
              </div>

              {/* Active panels — delegated to ReviewLayout */}
              <ReviewLayout
                activePanels={activePanels}
                impl={impl}
                slug={slug}
                executionState={effectiveExecutionState}
                repos={repos}
                onFileClick={(agent: string, wave: number, file: string) => setDiffTarget({ agent, wave, file })}
                onAmendComplete={() => onRefreshImpl?.(slug)}
              />
            </div>
          </>
        )}
      </div>

      {/* Sticky footer — inside scroll container so it respects center column width */}
      {!isNotSuitable && (
        <div className="sticky bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm flex items-stretch justify-center">
          <ActionButtons onApprove={handleApproveClick} onReject={onReject} onRequestChanges={() => setShowRevise(true)} onViewWaves={onViewWaves} hasWaveWork={hasWaveWork} needsCritic={needsCritic} criticReport={criticReport} criticRunning={criticRunning} onRunCritic={handleRunCritic} waveBoardExpanded={waveBoardExpanded} />
          <button
            onClick={() => togglePanel('validation')}
            className={`flex items-center justify-center text-sm font-medium px-6 h-14 transition-all duration-150 border-t-2 ${
              activePanels.includes('validation')
                ? 'border-t-blue-500 text-blue-700 dark:text-blue-400 bg-blue-500/10'
                : 'border-t-blue-500/40 text-muted-foreground hover:bg-blue-500/10 hover:text-foreground'
            }`}
          >
            <Tooltip content={panelTooltips['validation']} position="top">
              <span>Validate</span>
            </Tooltip>
          </button>
          <button
            onClick={() => { togglePanel('worktrees'); refreshWorktreeCount() }}
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
            <Tooltip content={panelTooltips['worktrees']} position="top">
              <span>Worktrees</span>
            </Tooltip>
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
            <Tooltip content="Chat with an AI about this IMPL doc. Ask questions about the plan, get explanations of agent briefs, or discuss implementation details." position="top">
              <span>{getChatButtonLabel}</span>
            </Tooltip>
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
