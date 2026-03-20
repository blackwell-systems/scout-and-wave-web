import { useState } from 'react'
import { useWaveEvents } from '../hooks/useWaveEvents'
import { useFileActivity } from '../hooks/useFileActivity'
import AgentCard from './AgentCard'
import ProgressBar from './ProgressBar'
import ImplEditor from './ImplEditor'
import StageTimeline from './StageTimeline'
import FileOwnershipTable from './FileOwnershipTable'
import { AgentStatus, RepoEntry, FileOwnershipEntry } from '../types'
import { mergeWave, runWaveTests, rerunAgent, batchDeleteWorktrees, startWave, retryFinalize, fixBuild } from '../api'
import { sawClient } from '../lib/apiClient'
import ScaffoldCard from './wave/ScaffoldCard'
import { WaveCompletionPanel } from './wave/WaveCompletionPanel'
import { WaveRecoveryPanel } from './wave/WaveRecoveryPanel'
import { WaveMergePanel } from './wave/WaveMergePanel'

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

export default function WaveBoard({ slug, compact, onRescout, repos }: WaveBoardProps): JSX.Element {
  // Optimistic status overrides — keyed by "wave:agent"
  const [statusOverrides, setStatusOverrides] = useState<Map<string, 'pending'>>(new Map())
  const [staleDismissed, setStaleDismissed] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [fileActivityExpanded, setFileActivityExpanded] = useState(false)

  const state = useWaveEvents(slug)
  const liveStatus = useFileActivity(state)

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
    setStatusOverrides(prev => {
      const next = new Map(prev)
      next.set(agentKey(agent.agent, agent.wave), 'pending')
      return next
    })
    try {
      await rerunAgent(slug, agent.wave, agent.agent, opts)
    } catch {
      setStatusOverrides(prev => {
        const next = new Map(prev)
        next.delete(agentKey(agent.agent, agent.wave))
        return next
      })
    }
  }

  async function handleRescout(agent: AgentStatus): Promise<void> {
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
        setStatusOverrides(prev => {
          const next = new Map(prev)
          next.delete(agentKey(agent.agent, agent.wave))
          return next
        })
      }
    }
  }

  async function handleProceedGate(nextWave: number): Promise<void> {
    try {
      await sawClient.wave.proceedGate(slug)
    } catch {
      await sawClient.wave.start(slug)
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
    const log = errorLog ?? state.runFailed ?? ''
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

        {/* Post-approval explanatory banner */}
        {!bannerDismissed && totalAgents > 0 && completeAgents === 0 && !state.runComplete && !state.runFailed && (
          <div className="mx-4 mb-3 flex items-start gap-3 bg-blue-950/40 border border-blue-800/60 rounded-lg px-4 py-3">
            <span className="text-blue-400 mt-0.5 shrink-0 text-sm">&#x2139;</span>
            <div className="flex-1 text-xs text-blue-300">
              {totalAgents} agent{totalAgents !== 1 ? 's' : ''} are running in parallel git
              worktrees. Each implements its assigned files independently. When all complete,
              the results are merged into your branch.
            </div>
            <button
              onClick={() => setBannerDismissed(true)}
              className="text-blue-400/60 hover:text-blue-300 text-sm leading-none shrink-0"
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>
        )}

        {/* Overall progress bar */}
        {totalAgents > 0 && (
          <ProgressBar complete={completeAgents} total={totalAgents} label="Overall progress" />
        )}

        {/* Run complete banner */}
        {state.runComplete && (
          <WaveCompletionPanel state={state} totalAgents={totalAgents} onRescout={onRescout} />
        )}

        {/* Run failed displays */}
        {state.runFailed && (
          <WaveRecoveryPanel
            slug={slug}
            state={state}
            onRetryFinalize={() => void handleRetryFinalize()}
            onFixBuild={() => void handleFixBuild()}
            onRescout={onRescout}
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
              <WaveMergePanel
                slug={slug}
                wave={wave}
                waveAgents={waveAgents}
                mergeState={state.wavesMergeState?.get(wave.wave)}
                testState={state.wavesTestState?.get(wave.wave)}
                hasGate={hasGate}
                waveGate={state.waveGate}
                fixBuildStatus={state.fixBuildStatus}
                fixBuildOutput={state.fixBuildOutput}
                fixBuildError={state.fixBuildError}
                onMerge={handleMergeWave}
                onRunTests={handleRunTests}
                onRetryFinalize={(w) => void handleRetryFinalize(w)}
                onFixBuild={(w, log, gate) => void handleFixBuild(w, log, gate)}
                onProceedGate={(nextWave) => void handleProceedGate(nextWave)}
                onStartWave={() => void startWave(slug)}
                allWaves={state.waves}
              />

              {/* Wave gate banner */}
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

        {/* File Activity section */}
        {(() => {
          const hasRunningAgents = displayAgents.some(a => a.status === 'running')
          if (!hasRunningAgents) return null

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
                  {fileActivityExpanded ? '\u25BC' : '\u25B6'}
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
