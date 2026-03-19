import { useState, useRef, useEffect } from 'react'
import { useWaveEvents } from '../hooks/useWaveEvents'
import type { AppWaveState } from '../hooks/useWaveEvents'
import { WaveMergeState, WaveTestState } from '../hooks/useWaveEvents'
import { useFileActivity } from '../hooks/useFileActivity'
import AgentCard from './AgentCard'
import ProgressBar from './ProgressBar'
import ImplEditor from './ImplEditor'
import StageTimeline from './StageTimeline'
import ConflictResolutionPanel from './ConflictResolutionPanel'
import FileOwnershipTable from './FileOwnershipTable'
import { AgentStatus, RepoEntry, FileOwnershipEntry } from '../types'
import { mergeWave, runWaveTests, rerunAgent, resolveConflicts, batchDeleteWorktrees, startWave, retryFinalize, fixBuild, retryStep, skipStep, forceMarkComplete } from '../api'
import RecoveryControlsPanel from './RecoveryControlsPanel'
import LiveOutputPanel from './LiveOutputPanel'

interface WaveBoardProps {
  slug: string
  compact?: boolean
  onRescout?: () => void
  repos?: RepoEntry[]   // optional — graceful fallback when empty
}

function detectRepoName(filePath: string, repos: RepoEntry[]): string {
  let best = ''
  let bestLen = 0
  for (const r of repos) {
    if (filePath.startsWith(r.path) && r.path.length > bestLen) {
      best = r.name
      bestLen = r.path.length
    }
  }
  return best
}

function dominantRepo(files: string[], repos: RepoEntry[]): string {
  const counts = new Map<string, number>()
  for (const f of files) {
    const name = detectRepoName(f, repos)
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [name, count] of counts) {
    if (count > bestCount) { best = name; bestCount = count }
  }
  return best
}

// Key for the optimistic agent status override map
function agentKey(agent: string, wave: number): string {
  return `${wave}:${agent}`
}

/** Scaffold card — matches AgentCard styling with streaming output. */
function ScaffoldCard({ status, output, error }: { status: string; output: string; error?: string }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!expanded && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [output, expanded])

  const borderStyle = status === 'complete'
    ? { borderColor: 'rgb(63, 185, 80)', boxShadow: '0 0 10px rgba(63, 185, 80, 0.3)' }
    : status === 'failed'
    ? { borderColor: 'rgb(248, 81, 73)', boxShadow: '0 0 12px rgba(248, 81, 73, 0.5)' }
    : { borderColor: 'rgb(88, 166, 255)', boxShadow: '0 0 12px rgba(88, 166, 255, 0.4)' }

  return (
    <div className="flex flex-col w-full overflow-hidden transition-all duration-200" style={{ borderRadius: '12px', border: '3px solid', ...borderStyle }}>
      <div className="flex items-center justify-between p-3 bg-black/20 dark:bg-white/5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg font-bold text-sm" style={{ backgroundColor: '#6b728020', color: '#6b7280', border: '2px solid #6b728050' }}>
            Sc
          </div>
          <div className="text-xs font-medium text-white/90">
            {status === 'complete' ? 'Complete' : status === 'failed' ? 'Failed' : 'Running'}
          </div>
        </div>
        {status === 'running' && (
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.2s' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.4s' }} />
          </div>
        )}
      </div>
      {output.length > 0 && (
        <div className="p-3">
          {output.length > 200 && (
            <button onClick={() => setExpanded(prev => !prev)} className="text-xs text-white/50 hover:text-white/80 cursor-pointer mb-1 block">
              {expanded ? '▲ Show less' : '▼ Show more'}
            </button>
          )}
          <pre ref={preRef} className={`text-xs font-mono text-white/70 bg-black/30 rounded p-2 overflow-y-auto whitespace-pre-wrap break-all ${expanded ? 'max-h-96' : 'max-h-32'}`}>
            {output}
          </pre>
        </div>
      )}
      {status === 'failed' && error && (
        <div className="p-3 pt-0">
          <div className="text-xs text-red-400 bg-red-500/10 rounded p-2 break-words">{error}</div>
        </div>
      )}
    </div>
  )
}

export default function WaveBoard({ slug, compact, onRescout, repos }: WaveBoardProps): JSX.Element {
  // Optimistic status overrides — keyed by "wave:agent"
  const [statusOverrides, setStatusOverrides] = useState<Map<string, 'pending'>>(new Map())
  const [staleDismissed, setStaleDismissed] = useState(false)
  const [fileActivityExpanded, setFileActivityExpanded] = useState(false)
  const [testOutputOpen, setTestOutputOpen] = useState<number | null>(null)
  const [fixBuildWave, setFixBuildWave] = useState<number | null>(null)
  const [fixOutputOpen, setFixOutputOpen] = useState<number | null>(null)

  const state = useWaveEvents(slug)
  const liveStatus = useFileActivity(state)

  // Auto-close test output panel when tests pass
  useEffect(() => {
    if (testOutputOpen !== null) {
      const testState = (state as AppWaveState & { wavesTestState?: Map<number, WaveTestState> }).wavesTestState?.get(testOutputOpen)
      if (testState?.status === 'pass') {
        setTestOutputOpen(null)
      }
    }
  }, [testOutputOpen, state])

  // Merge optimistic overrides on top of SSE-driven agent state
  function applyOverrides(agent: AgentStatus): AgentStatus {
    const key = agentKey(agent.agent, agent.wave)
    const override = statusOverrides.get(key)
    if (override) return { ...agent, status: override }
    return agent
  }

  const displayAgents = state.agents.map(applyOverrides)
  const totalAgents = displayAgents.length
  const completeAgents = displayAgents.filter(a => a.status === 'complete').length

  async function handleRerun(agent: AgentStatus, opts?: { scopeHint?: string }): Promise<void> {
    // Optimistic update: mark agent as pending immediately
    setStatusOverrides(prev => {
      const next = new Map(prev)
      next.set(agentKey(agent.agent, agent.wave), 'pending')
      return next
    })
    try {
      await rerunAgent(slug, agent.wave, agent.agent, opts)
    } catch {
      // Revert optimistic update on error
      setStatusOverrides(prev => {
        const next = new Map(prev)
        next.delete(agentKey(agent.agent, agent.wave))
        return next
      })
    }
  }

  async function handleRescout(agent: AgentStatus): Promise<void> {
    // Optimistic update: mark agent as pending immediately
    setStatusOverrides(prev => {
      const next = new Map(prev)
      next.set(agentKey(agent.agent, agent.wave), 'pending')
      return next
    })
    if (onRescout) {
      onRescout()
    } else {
      try {
        await rerunAgent(slug, agent.wave, agent.agent)
      } catch {
        // Revert optimistic update on error
        setStatusOverrides(prev => {
          const next = new Map(prev)
          next.delete(agentKey(agent.agent, agent.wave))
          return next
        })
      }
    }
  }

  async function handleProceedGate(nextWave: number): Promise<void> {
    const res = await fetch(`/api/wave/${encodeURIComponent(slug)}/gate/proceed`, { method: 'POST' })
    if (res.status === 404) {
      // Gate channel expired (server restarted or loop exited) — re-launch the run
      // which will pick up from the next pending wave automatically.
      await fetch(`/api/wave/${encodeURIComponent(slug)}/start`, { method: 'POST' })
    }
    void nextWave
  }

  async function handleRetryFinalize(waveNum?: number): Promise<void> {
    const wave = waveNum ?? Math.max(...state.waves.map(w => w.wave), 1)
    try {
      await retryFinalize(slug, wave)
    } catch (err) {
      console.error('retryFinalize request failed:', err)
    }
  }

  async function handleFixBuild(waveNum?: number, errorLog?: string, gateType?: string): Promise<void> {
    const wave = waveNum ?? Math.max(...state.waves.map(w => w.wave), 1)
    setFixBuildWave(wave)
    const log = errorLog ?? state.runFailed ?? ''
    // Extract gate type from error message if not provided (e.g. 'required gate "typecheck" failed')
    let gate = gateType
    if (!gate) {
      const gateMatch = log.match(/gate "(\w+)"/)
      gate = gateMatch ? gateMatch[1] : 'build'
    }
    try {
      await fixBuild(slug, wave, log, gate)
    } catch (err) {
      console.error('fixBuild request failed:', err)
    }
  }

  async function handleMergeWave(waveNum: number): Promise<void> {
    try {
      await mergeWave(slug, waveNum)
    } catch (err) {
      console.error('mergeWave request failed:', err)
    }
  }

  async function handleRunTests(waveNum: number): Promise<void> {
    try {
      await runWaveTests(slug, waveNum)
    } catch (err) {
      console.error('runWaveTests request failed:', err)
    }
  }

  function renderFailureActionButton(agent: AgentStatus): JSX.Element | null {
    const failureType = agent.failure_type

    if (failureType === 'escalate') {
      return (
        <div className="flex flex-col gap-1">
          <span className="self-start text-xs font-medium px-2 py-1 rounded bg-orange-50 border border-orange-300 text-orange-700 dark:bg-orange-950 dark:border-orange-700 dark:text-orange-400">
            Needs Manual Review
          </span>
          {agent.notes && (
            <p className="text-xs text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded px-2 py-1 max-w-xs break-words">
              {agent.notes}
            </p>
          )}
        </div>
      )
    }

    if (failureType === 'needs_replan') {
      return (
        <button
          onClick={() => void handleRescout(agent)}
          className="self-start text-xs font-medium px-2 py-1 rounded bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900 transition-colors"
        >
          &#x21BA; Re-Scout
        </button>
      )
    }

    if (failureType === 'timeout') {
      return (
        <button
          onClick={() => void handleRerun(agent, { scopeHint: 'Reduce scope: focus only on the files listed in your task. Skip any optional improvements.' })}
          className="self-start text-xs font-medium px-2 py-1 rounded bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900 transition-colors"
        >
          &#x21BA; Retry (scope down)
        </button>
      )
    }

    if (failureType === 'fixable') {
      return (
        <div className="flex flex-col gap-1">
          <button
            onClick={() => void handleRerun(agent)}
            className="self-start text-xs font-medium px-2 py-1 rounded bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900 transition-colors"
          >
            &#x21BA; Fix + Retry
          </button>
          {agent.notes && (
            <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded px-2 py-1 max-w-xs break-words">
              {agent.notes}
            </p>
          )}
        </div>
      )
    }

    // transient or undefined — default Retry
    return (
      <button
        onClick={() => void handleRerun(agent)}
        className="self-start text-xs font-medium px-2 py-1 rounded bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900 transition-colors"
      >
        &#x21BA; Retry
      </button>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-background p-4">
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold text-foreground">Wave Execution — {slug}</h1>
          {!state.connected && (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full animate-pulse">
              Reconnecting...
            </span>
          )}
        </div>

        {/* Stale branch warning banner */}
        {state.staleBranches && !staleDismissed && (
          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-amber-800 text-sm dark:bg-amber-950 dark:border-amber-800 dark:text-amber-400">
            <span>
              {state.staleBranches.count} stale branch{state.staleBranches.count !== 1 ? 'es' : ''} detected from previous runs.
            </span>
            <div className="flex items-center gap-2 ml-3">
              <button
                onClick={async () => {
                  try {
                    await batchDeleteWorktrees(slug, { branches: state.staleBranches!.branches, force: true })
                    setStaleDismissed(true)
                  } catch { /* ignore */ }
                }}
                className="text-xs font-medium px-3 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors"
              >
                Clean Up
              </button>
              <button
                onClick={() => setStaleDismissed(true)}
                className="text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200 font-bold text-lg leading-none"
                aria-label="Dismiss stale branch warning"
              >
                &times;
              </button>
            </div>
          </div>
        )}

        {/* Stage timeline — shows pipeline progress */}
        <StageTimeline entries={state.stageEntries} />

        {/* Overall progress bar */}
        {totalAgents > 0 && (
          <ProgressBar complete={completeAgents} total={totalAgents} label="Overall progress" />
        )}

        {/* Run complete banner */}
        {state.runComplete && (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center mb-4">
              <span className="text-green-600 dark:text-green-400 text-2xl">✓</span>
            </div>
            <h2 className="text-base font-semibold text-green-800 dark:text-green-300 mb-1">
              IMPL Complete
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              {state.waves.length} {state.waves.length === 1 ? 'wave' : 'waves'}, {totalAgents} {totalAgents === 1 ? 'agent' : 'agents'} — all merged and verified
            </p>
            <div className="flex gap-2">
              {onRescout && (
                <button
                  onClick={onRescout}
                  className="text-sm font-medium px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  Scout Next Feature
                </button>
              )}
            </div>
          </div>
        )}

        {/* Run failed — prominent display when no waves rendered */}
        {state.runFailed && state.waves.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center mb-4">
              <span className="text-red-600 dark:text-red-400 text-xl font-bold">!</span>
            </div>
            <h2 className="text-base font-semibold text-red-800 dark:text-red-300 mb-2">Wave Execution Failed</h2>
            <p className="text-sm text-red-700 dark:text-red-400 max-w-md break-words">{state.runFailed}</p>
            {state.runFailed.includes('FinalizeWave') && (
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => void handleRetryFinalize()}
                  className="text-sm font-medium px-4 py-2 rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                >
                  &#x21BA; Retry Finalization
                </button>
                <button
                  onClick={() => void handleFixBuild()}
                  disabled={state.fixBuildStatus === 'running'}
                  className="text-sm font-medium px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {state.fixBuildStatus === 'running' ? 'Fixing…' : '✦ Fix with AI'}
                </button>
              </div>
            )}
            {Object.keys(state.pipelineSteps ?? {}).length > 0 && (
              <div className="mt-4 w-full max-w-md">
                <RecoveryControlsPanel
                  slug={slug}
                  wave={Math.max(...state.waves.map(w => w.wave), 1)}
                  pipelineSteps={state.pipelineSteps ?? {}}
                  onRetryStep={async (step, wave) => { await retryStep(slug, step, wave) }}
                  onSkipStep={async (step, wave, reason) => { await skipStep(slug, step, wave, reason) }}
                  onForceComplete={async () => { await forceMarkComplete(slug) }}
                  onRetryFinalize={async () => { await handleRetryFinalize() }}
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-4">Press Escape to close this panel</p>
          </div>
        )}
        {/* Run failed banner — inline when waves are also showing */}
        {state.runFailed && state.waves.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-800 text-sm dark:bg-red-950 dark:border-red-800 dark:text-red-400 flex items-center justify-between gap-2">
            <span><span className="font-medium">Wave failed:</span> {state.runFailed}</span>
            {state.runFailed.includes('FinalizeWave') && (
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => void handleRetryFinalize()}
                  className="text-xs font-medium px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                >
                  &#x21BA; Retry
                </button>
                <button
                  onClick={() => void handleFixBuild()}
                  disabled={state.fixBuildStatus === 'running'}
                  className="text-xs font-medium px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {state.fixBuildStatus === 'running' ? 'Fixing…' : '✦ Fix with AI'}
                </button>
              </div>
            )}
          </div>
        )}
        {state.runFailed && state.waves.length > 0 && Object.keys(state.pipelineSteps ?? {}).length > 0 && (
          <RecoveryControlsPanel
            slug={slug}
            wave={Math.max(...state.waves.map(w => w.wave), 1)}
            pipelineSteps={state.pipelineSteps ?? {}}
            onRetryStep={async (step, wave) => { await retryStep(slug, step, wave) }}
            onSkipStep={async (step, wave, reason) => { await skipStep(slug, step, wave, reason) }}
            onForceComplete={async () => { await forceMarkComplete(slug) }}
            onRetryFinalize={async () => { await handleRetryFinalize() }}
          />
        )}


        {/* Scaffold row */}
        {state.scaffoldStatus !== 'idle' && (
          <ScaffoldCard status={state.scaffoldStatus} output={state.scaffoldOutput} error={state.error} />
        )}

        {/* Empty state — no waves loaded yet */}
        {state.waves.length === 0 && state.scaffoldStatus === 'idle' && !state.runFailed && (
          <div className="bg-card border border-border rounded-lg p-8 text-center">
            <p className="text-muted-foreground text-sm mb-2">
              {state.connected ? 'Waiting for wave execution to start...' : 'Connecting to wave execution stream...'}
            </p>
            {state.staleBranches && (
              <p className="text-amber-600 dark:text-amber-400 text-xs">
                Clean up stale branches from previous runs to proceed
              </p>
            )}
          </div>
        )}

        {/* Start execution — show when waves are loaded but none have started */}
        {state.waves.length > 0 && state.waves.every(w => w.agents.every(a => a.status === 'pending' || !a.status)) && !state.runFailed && state.scaffoldStatus !== 'running' && (
          <button
            onClick={() => void startWave(slug)}
            className="w-full text-sm font-medium px-4 py-2.5 rounded-none bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25 hover:border-blue-500/50 active:scale-[0.98] transition-all backdrop-blur-sm"
          >
            Start Execution
          </button>
        )}

        {/* Wave rows */}
        {state.waves.map(wave => {
          // Compute display agents for this wave (with overrides applied)
          const waveAgents = wave.agents.map(applyOverrides)
          const waveComplete = waveAgents.filter(a => a.status === 'complete').length
          const waveTotal = waveAgents.length
          const hasGate = state.waveGate?.wave === wave.wave
          return (
            <div key={wave.wave}>
              <div className="bg-card border border-border rounded-lg p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground text-sm">Wave {wave.wave}</span>
                  {wave.complete && (wave.merge_status === 'merged' || wave.merge_status === 'success') && (
                    <span className="text-xs text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900 px-2 py-0.5 rounded-full">
                      Merged
                    </span>
                  )}
                </div>

                {waveTotal > 0 && (
                  <ProgressBar complete={waveComplete} total={waveTotal} />
                )}

                <div className={compact ? 'flex flex-col gap-2' : 'flex flex-wrap gap-3'}>
                  {waveAgents.map(agent => {
                    const tag = dominantRepo(agent.files ?? [], repos ?? [])
                    return (
                      <div key={`${agent.agent}-${agent.wave}`} className="flex flex-col gap-1">
                        <AgentCard agent={agent} />
                        {tag && (
                          <span className="self-start text-[9px] font-mono px-1.5 py-0.5 rounded border border-border text-muted-foreground bg-muted">
                            [{tag}]
                          </span>
                        )}
                        {agent.status === 'failed' && renderFailureActionButton(agent)}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Merge and test controls */}
              {(() => {
                const mergeState = (state as AppWaveState & { wavesMergeState?: Map<number, WaveMergeState>; wavesTestState?: Map<number, WaveTestState> }).wavesMergeState?.get(wave.wave)
                const testState = (state as AppWaveState & { wavesMergeState?: Map<number, WaveMergeState>; wavesTestState?: Map<number, WaveTestState> }).wavesTestState?.get(wave.wave)
                const allComplete = waveComplete === waveTotal && waveTotal > 0
                const alreadyMerged = wave.merge_status === 'merged' || wave.merge_status === 'success'
                // Live SSE merge state takes priority over disk-seeded status —
                // if the pipeline just failed, don't show "merged" from a stale disk read.
                const mergeStatus = mergeState?.status ?? (alreadyMerged ? 'success' : 'idle')
                const testStatus = testState?.status ?? 'idle'

                return (
                  <>
                    {/* Merge button */}
                    {allComplete && mergeStatus === 'idle' && !hasGate && (
                      <button
                        onClick={() => void handleMergeWave(wave.wave)}
                        className="mt-3 w-full text-sm font-medium px-4 py-2.5 rounded-none bg-violet-600 text-white hover:bg-violet-700 active:scale-[0.98] transition-all"
                      >
                        Merge Wave {wave.wave}
                      </button>
                    )}

                    {/* Merging in progress */}
                    {mergeStatus === 'merging' && (
                      <div className="mt-3 bg-violet-50 border border-violet-200 rounded-none px-4 py-2 text-violet-700 text-sm animate-pulse dark:bg-violet-950 dark:border-violet-800 dark:text-violet-400">
                        Merging Wave {wave.wave}...
                      </div>
                    )}

                    {/* Merge success */}
                    {mergeStatus === 'success' && (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-none px-4 py-2 dark:bg-green-950 dark:border-green-800">
                          <span className="text-green-800 text-sm dark:text-green-400">Wave {wave.wave} merged successfully</span>
                          <button
                            onClick={async () => {
                              const branches = wave.agents.map(a => `wave${wave.wave}-agent-${a.agent}`)
                              try { await batchDeleteWorktrees(slug, { branches, force: true }) } catch { /* already cleaned */ }
                            }}
                            className="text-xs text-green-700 hover:text-green-900 dark:text-green-400 dark:hover:text-green-200 underline"
                          >
                            Clean worktrees
                          </button>
                        </div>

                        {testStatus === 'idle' && (
                          <div className="flex">
                            <button
                              onClick={() => void handleRunTests(wave.wave)}
                              className="flex-1 text-sm font-medium px-4 py-2.5 rounded-none bg-teal-500/15 text-teal-400 border border-teal-500/30 hover:bg-teal-500/25 hover:border-teal-500/50 active:scale-[0.98] transition-all backdrop-blur-sm"
                            >
                              Run Tests
                            </button>
                            <button
                              onClick={() => setTestOutputOpen(testOutputOpen === wave.wave ? null : wave.wave)}
                              className={`px-3 py-2.5 rounded-none border-l-0 border text-xs font-medium transition-all backdrop-blur-sm ${testOutputOpen === wave.wave ? 'bg-teal-500/30 border-teal-500/50 text-teal-300' : 'bg-teal-500/15 border-teal-500/30 text-teal-400 hover:bg-teal-500/25'}`}
                              title="Toggle live output"
                            >
                              Watch
                            </button>
                          </div>
                        )}

                        {testStatus === 'running' && (
                          <div className="flex">
                            <div className="flex-1 bg-teal-500/15 border border-teal-500/30 rounded-none px-4 py-2.5 text-teal-400 text-sm animate-pulse">
                              Running tests...
                            </div>
                            <button
                              onClick={() => setTestOutputOpen(testOutputOpen === wave.wave ? null : wave.wave)}
                              className={`px-3 py-2.5 rounded-none border-l-0 border text-xs font-medium transition-all backdrop-blur-sm ${testOutputOpen === wave.wave ? 'bg-teal-500/30 border-teal-500/50 text-teal-300' : 'bg-teal-500/15 border-teal-500/30 text-teal-400 hover:bg-teal-500/25'}`}
                              title="Toggle live output"
                            >
                              Watch
                            </button>
                          </div>
                        )}

                        {testStatus === 'pass' && (
                          <div className="bg-green-50 border border-green-200 rounded-none px-4 py-2 text-green-800 text-sm dark:bg-green-950 dark:border-green-800 dark:text-green-400">
                            Tests passed ✓
                          </div>
                        )}

                        {testStatus === 'fail' && !(fixBuildWave === wave.wave && fixOutputOpen === wave.wave) && (
                          <div className="bg-red-50 border border-red-200 rounded-none px-4 py-3 space-y-2 dark:bg-red-950 dark:border-red-800">
                            <div className="flex items-center justify-between">
                              <p className="text-red-800 text-sm font-medium dark:text-red-400">Tests failed</p>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => void handleRunTests(wave.wave)}
                                  className="text-xs font-medium px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                                >
                                  &#x21BA; Retry
                                </button>
                                <div className="flex">
                                  <button
                                    onClick={() => void handleFixBuild(wave.wave, testState?.output || 'Tests failed', 'test')}
                                    disabled={state.fixBuildStatus === 'running'}
                                    className="text-xs font-medium px-2 py-1 rounded-none rounded-l bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                                  >
                                    {state.fixBuildStatus === 'running' ? 'Fixing…' : '✦ Fix with AI'}
                                  </button>
                                  <button
                                    onClick={() => setFixOutputOpen(fixOutputOpen === wave.wave ? null : wave.wave)}
                                    className={`text-xs font-medium px-2 py-1 rounded-none rounded-r border-l border-blue-500 transition-colors ${fixOutputOpen === wave.wave ? 'bg-blue-500 text-white' : 'bg-blue-600/60 text-blue-200 hover:bg-blue-600'}`}
                                    title="Toggle AI fix output"
                                  >
                                    Watch
                                  </button>
                                </div>
                              </div>
                            </div>
                            {testState?.output && (
                              <pre className="text-xs font-mono text-red-700 bg-red-100 dark:bg-red-900 dark:text-red-300 rounded p-2 overflow-y-auto max-h-48 whitespace-pre-wrap break-all">
                                {testState.output}
                              </pre>
                            )}
                          </div>
                        )}

                        {/* Live test output panel — toggled by Watch button */}
                        {testOutputOpen === wave.wave && (
                          <LiveOutputPanel
                            status={testStatus === 'running' ? 'running' : testStatus === 'pass' ? 'complete' : testStatus === 'fail' ? 'failed' : 'idle'}
                            output={testState?.output ?? ''}
                            runningLabel="⬤ Live output"
                            doneLabel="Test output"
                            failedLabel="Test output"
                            accentColor="teal"
                            onClose={() => setTestOutputOpen(null)}
                          />
                        )}

                        {/* AI fix output — toggled by Watch button */}
                        {fixBuildWave === wave.wave && fixOutputOpen === wave.wave && state.fixBuildStatus !== 'idle' && (
                          <LiveOutputPanel
                            status={state.fixBuildStatus}
                            output={state.fixBuildOutput + (state.fixBuildError ? `\n\nError: ${state.fixBuildError}` : '')}
                            runningLabel="⬤ AI fixing…"
                            doneLabel="✦ AI fix complete"
                            failedLabel="✦ AI fix failed"
                            accentColor="blue"
                            onClose={() => setFixOutputOpen(null)}
                            actions={state.fixBuildStatus === 'complete' ? (
                              <button
                                onClick={() => void handleRetryFinalize(wave.wave)}
                                className="text-xs font-medium px-2 py-1 rounded-none bg-green-600 text-white hover:bg-green-700 transition-colors"
                              >
                                &#x21BA; Retry Finalization
                              </button>
                            ) : undefined}
                          />
                        )}

                        {/* Start Next Wave — show after merge success if next wave is still fully pending and no gate is active */}
                        {(() => {
                          const nextWave = state.waves.find(w => w.wave === wave.wave + 1)
                          const nextWaveFullyPending = nextWave && !nextWave.complete && nextWave.agents.every(a => a.status === 'pending' || !a.status)
                          const isLastWave = wave.wave >= Math.max(...state.waves.map(w => w.wave))
                          return !isLastWave && nextWaveFullyPending && !hasGate && !state.waveGate && (
                            <button
                              onClick={() => void startWave(slug)}
                              className="w-full text-sm font-medium px-4 py-2.5 rounded-none bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25 hover:border-blue-500/50 active:scale-[0.98] transition-all backdrop-blur-sm"
                            >
                              Start Wave {wave.wave + 1}
                            </button>
                          )
                        })()}
                      </div>
                    )}

                    {/* Merge failed */}
                    {mergeStatus === 'failed' && (
                      <div className="mt-3 space-y-2">
                        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-2 dark:bg-red-950 dark:border-red-800">
                          <p className="text-red-800 text-sm font-medium dark:text-red-400">
                            Merge failed: {mergeState?.error}
                          </p>
                          {(mergeState?.conflictingFiles?.length ?? 0) > 0 && (
                            <ul className="mt-1 space-y-0.5">
                              {mergeState!.conflictingFiles.map(f => (
                                <li key={f} className="font-mono text-xs text-red-700 dark:text-red-300">{f}</li>
                              ))}
                            </ul>
                          )}
                          <div className="flex items-center gap-2 mt-3">
                            <button
                              onClick={() => void handleMergeWave(wave.wave)}
                              className="text-xs font-medium px-3 py-1.5 rounded-md bg-gray-600 text-white hover:bg-gray-700 transition-colors"
                            >
                              Abort Merge
                            </button>
                            {(mergeState?.conflictingFiles?.length ?? 0) > 0 && (
                              <button
                                onClick={() => void resolveConflicts(slug, wave.wave)}
                                className="text-xs font-medium px-3 py-1.5 rounded-md bg-violet-600 text-white hover:bg-violet-700 transition-colors"
                              >
                                Resolve with AI
                              </button>
                            )}
                            <button
                              onClick={() => void handleMergeWave(wave.wave)}
                              className="text-xs font-medium px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                            >
                              Retry Merge
                            </button>
                          </div>
                        </div>
                        
                        {mergeState?.resolutionError && (
                          <ConflictResolutionPanel
                            slug={slug}
                            wave={wave.wave}
                            conflictingFiles={mergeState?.conflictingFiles ?? []}
                            onResolveStart={() => void resolveConflicts(slug, wave.wave)}
                            resolvingFile={mergeState?.resolvingFile}
                            resolvedFiles={mergeState?.resolvedFiles ?? []}
                            resolutionError={mergeState?.resolutionError}
                            failedFile={mergeState?.failedFile}
                            isResolving={false}
                            output={mergeState?.output}
                          />
                        )}
                      </div>
                    )}

                    {/* AI Resolving conflicts */}
                    {mergeStatus === 'resolving' && (
                      <ConflictResolutionPanel
                        slug={slug}
                        wave={wave.wave}
                        conflictingFiles={mergeState?.conflictingFiles ?? []}
                        onResolveStart={() => void resolveConflicts(slug, wave.wave)}
                        resolvingFile={mergeState?.resolvingFile}
                        resolvedFiles={mergeState?.resolvedFiles ?? []}
                        resolutionError={mergeState?.resolutionError}
                        failedFile={mergeState?.failedFile}
                        isResolving={true}
                        output={mergeState?.output}
                      />
                    )}
                  </>
                )
              })()}

              {/* Wave gate banner — shown after this wave row when gate is pending */}
              {hasGate && state.waveGate && (
                <div className="mt-3 bg-blue-500/10 border border-blue-500/30 rounded-none p-4 space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                      Wave {wave.wave} merged and verified
                    </p>
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                      Review or edit the IMPL doc, then proceed to Wave {state.waveGate.nextWave}
                    </p>
                  </div>
                  <button
                    onClick={() => void handleProceedGate(state.waveGate!.nextWave)}
                    className="w-full text-sm font-medium px-4 py-2.5 rounded-none bg-blue-500/15 text-blue-400 border border-blue-500/30 hover:bg-blue-500/25 hover:border-blue-500/50 active:scale-[0.98] transition-all backdrop-blur-sm"
                  >
                    Proceed to Wave {state.waveGate.nextWave} &rarr;
                  </button>
                  <div className="overflow-x-hidden">
                    <ImplEditor slug={slug} />
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* File Activity section — only shown when there are running agents */}
        {(() => {
          const hasRunningAgents = displayAgents.some(a => a.status === 'running')
          if (!hasRunningAgents) return null

          // Build FileOwnershipEntry[] from running agents
          const fileEntries: FileOwnershipEntry[] = displayAgents
            .filter(a => a.status === 'running')
            .flatMap(a =>
              (a.files ?? []).map(f => ({
                file: f,
                agent: a.agent,
                wave: a.wave,
                action: '',
                depends_on: '',
              }))
            )

          if (fileEntries.length === 0) return null

          return (
            <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
              <button
                onClick={() => setFileActivityExpanded(prev => !prev)}
                className="flex items-center justify-between w-full text-left mb-3"
              >
                <span className="font-semibold text-foreground text-sm">
                  File Activity
                </span>
                <span className="text-muted-foreground text-xs">
                  {fileActivityExpanded ? '▼' : '▶'}
                </span>
              </button>
              {fileActivityExpanded && (
                <FileOwnershipTable
                  fileOwnership={fileEntries}
                  liveStatus={liveStatus}
                />
              )}
            </div>
          )
        })()}

      </div>
    </div>
  )
}
