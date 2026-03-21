import { useState } from 'react'
import type { AgentStatus, WaveState } from '../../types'
import type { WaveMergeState, WaveTestState } from '../../hooks/useWaveEvents'
import { batchDeleteWorktrees, resolveConflicts } from '../../api'
import ConflictResolutionPanel from '../ConflictResolutionPanel'
import LiveOutputPanel from '../LiveOutputPanel'

export interface WaveMergePanelProps {
  slug: string
  wave: WaveState
  waveAgents: AgentStatus[]
  mergeState?: WaveMergeState
  testState?: WaveTestState
  hasGate: boolean
  waveGate?: { wave: number; nextWave: number } | null
  fixBuildStatus: string
  fixBuildOutput: string
  fixBuildError?: string
  onMerge: (wave: number) => void
  onRunTests: (wave: number) => void
  onRetryFinalize: (wave?: number) => void
  onFixBuild: (wave?: number, errorLog?: string, gateType?: string) => void
  onProceedGate: (nextWave: number) => void
  onStartWave: () => void
  /** All waves — needed for "Start Next Wave" logic */
  allWaves?: WaveState[]
}

/** Merge controls, test controls, and live output panels for a single wave. */
export function WaveMergePanel({
  slug,
  wave,
  waveAgents,
  mergeState,
  testState,
  hasGate,
  waveGate,
  fixBuildStatus,
  fixBuildOutput,
  fixBuildError,
  onMerge,
  onRunTests,
  onRetryFinalize,
  onFixBuild,
  onProceedGate: _onProceedGate,
  onStartWave,
  allWaves,
}: WaveMergePanelProps): JSX.Element {
  const [testOutputOpen, setTestOutputOpen] = useState<number | null>(null)
  const [fixBuildWave, setFixBuildWave] = useState<number | null>(null)
  const [fixOutputOpen, setFixOutputOpen] = useState<number | null>(null)

  const waveComplete = waveAgents.filter(a => a.status === 'complete').length
  const waveTotal = waveAgents.length
  const allComplete = waveComplete === waveTotal && waveTotal > 0
  const alreadyMerged = wave.merge_status === 'merged' || wave.merge_status === 'success'
  // Disk-confirmed merge is authoritative — overrides stale SSE failure state
  const mergeStatus = alreadyMerged ? 'success' : (mergeState?.status ?? 'idle')
  const testStatus = testState?.status ?? 'idle'

  return (
    <>
      {/* Merge button */}
      {allComplete && mergeStatus === 'idle' && !hasGate && (
        <button
          onClick={() => void onMerge(wave.wave)}
          className="mt-3 w-full text-sm font-medium px-4 py-2.5 rounded-none border border-violet-400 dark:border-violet-600 text-violet-800 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40 active:scale-[0.98] transition-all"
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
                onClick={() => void onRunTests(wave.wave)}
                className="flex-1 text-sm font-medium px-4 py-2.5 rounded-none border border-teal-400 dark:border-teal-600 text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 active:scale-[0.98] transition-all"
              >
                Run Tests
              </button>
              <button
                onClick={() => setTestOutputOpen(testOutputOpen === wave.wave ? null : wave.wave)}
                className={`px-3 py-2.5 rounded-none border-l-0 border text-xs font-medium transition-all ${testOutputOpen === wave.wave ? 'bg-teal-100 dark:bg-teal-900/40 border-teal-400 dark:border-teal-600 text-teal-800 dark:text-teal-300' : 'border-teal-400 dark:border-teal-600 text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/40'}`}
                title="Toggle live output"
              >
                Watch
              </button>
            </div>
          )}

          {testStatus === 'running' && (
            <div className="flex">
              <div className="flex-1 border border-teal-400 dark:border-teal-600 rounded-none px-4 py-2.5 text-teal-800 dark:text-teal-300 text-sm animate-pulse">
                Running tests...
              </div>
              <button
                onClick={() => setTestOutputOpen(testOutputOpen === wave.wave ? null : wave.wave)}
                className={`px-3 py-2.5 rounded-none border-l-0 border text-xs font-medium transition-all ${testOutputOpen === wave.wave ? 'bg-teal-100 dark:bg-teal-900/40 border-teal-400 dark:border-teal-600 text-teal-800 dark:text-teal-300' : 'border-teal-400 dark:border-teal-600 text-teal-800 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/40'}`}
                title="Toggle live output"
              >
                Watch
              </button>
            </div>
          )}

          {testStatus === 'pass' && (
            <div className="bg-green-50 border border-green-200 rounded-none px-4 py-2 text-green-800 text-sm dark:bg-green-950 dark:border-green-800 dark:text-green-400">
              Tests passed &#x2713;
            </div>
          )}

          {testStatus === 'fail' && !(fixBuildWave === wave.wave && fixOutputOpen === wave.wave) && (
            <div className="bg-red-50 border border-red-200 rounded-none px-4 py-3 space-y-2 dark:bg-red-950 dark:border-red-800">
              <div className="flex items-center justify-between">
                <p className="text-red-800 text-sm font-medium dark:text-red-400">Tests failed</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => void onRunTests(wave.wave)}
                    className="text-xs font-medium px-2 py-1 rounded-none border border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                  >
                    &#x21BA; Retry
                  </button>
                  <div className="flex">
                    <button
                      onClick={() => {
                        setFixBuildWave(wave.wave)
                        void onFixBuild(wave.wave, testState?.output || 'Tests failed', 'test')
                      }}
                      disabled={fixBuildStatus === 'running'}
                      className="text-xs font-medium px-2 py-1 rounded-none border border-blue-400 dark:border-blue-600 text-blue-800 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 disabled:opacity-50 transition-colors"
                    >
                      {fixBuildStatus === 'running' ? 'Fixing\u2026' : '\u2726 Fix with AI'}
                    </button>
                    <button
                      onClick={() => setFixOutputOpen(fixOutputOpen === wave.wave ? null : wave.wave)}
                      className={`text-xs font-medium px-2 py-1 rounded-none border-l-0 border border-blue-400 dark:border-blue-600 transition-colors ${fixOutputOpen === wave.wave ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300' : 'text-blue-800 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40'}`}
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

          {/* Live test output panel */}
          {testOutputOpen === wave.wave && (
            <LiveOutputPanel
              status={testStatus === 'running' ? 'running' : testStatus === 'pass' ? 'complete' : testStatus === 'fail' ? 'failed' : 'idle'}
              output={testState?.output ?? ''}
              runningLabel="\u2B24 Live output"
              doneLabel="Test output"
              failedLabel="Test output"
              accentColor="teal"
              onClose={() => setTestOutputOpen(null)}
            />
          )}

          {/* AI fix output */}
          {fixBuildWave === wave.wave && fixOutputOpen === wave.wave && fixBuildStatus !== 'idle' && (
            <LiveOutputPanel
              status={fixBuildStatus as 'running' | 'complete' | 'failed' | 'idle'}
              output={fixBuildOutput + (fixBuildError ? `\n\nError: ${fixBuildError}` : '')}
              runningLabel="\u2B24 AI fixing\u2026"
              doneLabel="\u2726 AI fix complete"
              failedLabel="\u2726 AI fix failed"
              accentColor="blue"
              onClose={() => setFixOutputOpen(null)}
              actions={fixBuildStatus === 'complete' ? (
                <button
                  onClick={() => void onRetryFinalize(wave.wave)}
                  className="text-xs font-medium px-2 py-1 rounded-none border border-green-400 dark:border-green-600 text-green-800 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
                >
                  &#x21BA; Retry Finalization
                </button>
              ) : undefined}
            />
          )}

          {/* Start Next Wave — show after merge success if next wave is still fully pending */}
          {(() => {
            const waves = allWaves ?? []
            const nextWave = waves.find(w => w.wave === wave.wave + 1)
            const nextWaveFullyPending = nextWave && !nextWave.complete && nextWave.agents.every(a => a.status === 'pending' || !a.status)
            const isLastWave = wave.wave >= Math.max(...waves.map(w => w.wave))
            return !isLastWave && nextWaveFullyPending && !hasGate && !waveGate && (
              <div className="mt-3 bg-green-500/10 border border-green-500/30 rounded-none px-4 py-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                    Wave {wave.wave} complete
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                    Wave {wave.wave + 1} is ready to run
                  </p>
                </div>
                <button
                  onClick={() => void onStartWave()}
                  className="shrink-0 text-sm font-semibold px-5 py-2.5 rounded-none border border-green-400 dark:border-green-600 text-green-800 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40 active:scale-[0.98] transition-all"
                >
                  Run Wave {wave.wave + 1} &rarr;
                </button>
              </div>
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
                onClick={() => void onMerge(wave.wave)}
                className="text-xs font-medium px-3 py-1.5 rounded-none border border-gray-400 dark:border-gray-600 text-gray-800 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-900/40 transition-colors"
              >
                Abort Merge
              </button>
              {(mergeState?.conflictingFiles?.length ?? 0) > 0 && (
                <button
                  onClick={() => void resolveConflicts(slug, wave.wave)}
                  className="text-xs font-medium px-3 py-1.5 rounded-none border border-violet-400 dark:border-violet-600 text-violet-800 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
                >
                  Resolve with AI
                </button>
              )}
              <button
                onClick={() => void onMerge(wave.wave)}
                className="text-xs font-medium px-3 py-1.5 rounded-none border border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
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
}
