import { useState } from 'react'
import { useWaveEvents } from '../hooks/useWaveEvents'
import { useGitActivity } from '../hooks/useGitActivity'
import AgentCard from './AgentCard'
import ProgressBar from './ProgressBar'
import GitActivitySidebar from './git/GitActivitySidebar'
import { AgentStatus } from '../types'

interface WaveBoardProps {
  slug: string
}

// Key for the optimistic agent status override map
function agentKey(agent: string, wave: number): string {
  return `${wave}:${agent}`
}

export default function WaveBoard({ slug }: WaveBoardProps): JSX.Element {
  // Optimistic status overrides — keyed by "wave:agent"
  const [statusOverrides, setStatusOverrides] = useState<Map<string, 'pending'>>(new Map())

  const state = useWaveEvents(slug)
  const gitSnapshot = useGitActivity(slug)

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

  async function handleRerun(agent: AgentStatus): Promise<void> {
    // Optimistic update: mark agent as pending immediately
    setStatusOverrides(prev => {
      const next = new Map(prev)
      next.set(agentKey(agent.agent, agent.wave), 'pending')
      return next
    })
    try {
      const res = await fetch(
        `/api/wave/${encodeURIComponent(slug)}/agent/${encodeURIComponent(agent.agent)}/rerun`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wave: agent.wave }),
        }
      )
      if (res.status !== 202) {
        // Revert optimistic update on non-202
        setStatusOverrides(prev => {
          const next = new Map(prev)
          next.delete(agentKey(agent.agent, agent.wave))
          return next
        })
      }
    } catch {
      // Revert optimistic update on network error
      setStatusOverrides(prev => {
        const next = new Map(prev)
        next.delete(agentKey(agent.agent, agent.wave))
        return next
      })
    }
  }

  async function handleProceedGate(nextWave: number): Promise<void> {
    await fetch(`/api/wave/${encodeURIComponent(slug)}/gate/proceed`, { method: 'POST' })
    void nextWave
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6">
      <div className="flex gap-6 items-start">
        <div className="flex-1 min-w-0 space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Wave Execution — {slug}</h1>
            {!state.connected && (
              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full animate-pulse">
                Reconnecting...
              </span>
            )}
          </div>

          {/* Overall progress bar */}
          {totalAgents > 0 && (
            <ProgressBar complete={completeAgents} total={totalAgents} label="Overall progress" />
          )}

          {/* Run complete banner */}
          {state.runComplete && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-800 text-sm font-medium dark:bg-green-950 dark:border-green-800 dark:text-green-400">
              Run complete{state.runStatus ? ` — ${state.runStatus}` : ''}
            </div>
          )}

          {/* Run failed banner */}
          {state.runFailed && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-800 text-sm dark:bg-red-950 dark:border-red-800 dark:text-red-400">
              <span className="font-medium">Wave failed:</span> {state.runFailed}
            </div>
          )}

          {/* Scaffold row */}
          {state.scaffoldStatus !== 'idle' && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Scaffold</span>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    state.scaffoldStatus === 'complete'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-blue-100 text-blue-700 animate-pulse'
                  }`}
                >
                  {state.scaffoldStatus === 'complete' ? 'Complete' : 'Running'}
                </span>
              </div>
            </div>
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
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Wave {wave.wave}</span>
                    {wave.complete && wave.merge_status && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                        merge: {wave.merge_status}
                      </span>
                    )}
                  </div>

                  {waveTotal > 0 && (
                    <ProgressBar complete={waveComplete} total={waveTotal} />
                  )}

                  <div className="flex flex-wrap gap-3">
                    {waveAgents.map(agent => (
                      <div key={`${agent.agent}-${agent.wave}`} className="flex flex-col gap-1">
                        <AgentCard agent={agent} />
                        {agent.status === 'failed' && (
                          <button
                            onClick={() => void handleRerun(agent)}
                            className="self-start text-xs font-medium px-2 py-1 rounded bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900 transition-colors"
                          >
                            &#x21BA; Re-run
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Wave gate banner — shown after this wave row when gate is pending */}
                {hasGate && state.waveGate && (
                  <div className="mt-3 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                        Wave {wave.wave} complete
                      </p>
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                        Ready to launch Wave {state.waveGate.nextWave}
                      </p>
                    </div>
                    <button
                      onClick={() => void handleProceedGate(state.waveGate!.nextWave)}
                      className="text-sm font-medium px-4 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors whitespace-nowrap"
                    >
                      Proceed to Wave {state.waveGate.nextWave} &rarr;
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {/* Empty state */}
          {state.waves.length === 0 && state.scaffoldStatus === 'idle' && (
            <div className="text-center text-gray-400 dark:text-gray-500 text-sm py-12">
              Waiting for wave to start...
            </div>
          )}
        </div>

        {/* Git activity sidebar */}
        <div className="w-80 shrink-0 sticky top-6">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Git Activity</h2>
            <GitActivitySidebar slug={slug} snapshot={gitSnapshot} />
          </div>
        </div>
      </div>
    </div>
  )
}
