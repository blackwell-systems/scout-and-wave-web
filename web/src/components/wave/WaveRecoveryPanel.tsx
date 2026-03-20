import type { AppWaveState } from '../../hooks/useWaveEvents'
import RecoveryControlsPanel from '../RecoveryControlsPanel'
import { retryStep, skipStep, forceMarkComplete } from '../../api'

export interface WaveRecoveryPanelProps {
  slug: string
  state: AppWaveState
  onRetryFinalize: () => void
  onFixBuild: () => void
  onRescout?: () => void
}

/** Run-failed displays — both prominent (no waves) and inline banner (with waves). */
export function WaveRecoveryPanel({ slug, state, onRetryFinalize, onFixBuild }: WaveRecoveryPanelProps): JSX.Element {
  const maxWave = Math.max(...state.waves.map(w => w.wave), 1)

  return (
    <>
      {/* Prominent display when no waves rendered */}
      {state.waves.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center mb-4">
            <span className="text-red-600 dark:text-red-400 text-xl font-bold">!</span>
          </div>
          <h2 className="text-base font-semibold text-red-800 dark:text-red-300 mb-2">Wave Execution Failed</h2>
          <p className="text-sm text-red-700 dark:text-red-400 max-w-md break-words">{state.runFailed}</p>
          {state.runFailed?.includes('FinalizeWave') && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={onRetryFinalize}
                className="text-sm font-medium px-4 py-2 rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors"
              >
                &#x21BA; Retry Finalization
              </button>
              <button
                onClick={onFixBuild}
                disabled={state.fixBuildStatus === 'running'}
                className="text-sm font-medium px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {state.fixBuildStatus === 'running' ? 'Fixing\u2026' : '\u2726 Fix with AI'}
              </button>
            </div>
          )}
          {Object.keys(state.pipelineSteps ?? {}).length > 0 && (
            <div className="mt-4 w-full max-w-md">
              <RecoveryControlsPanel
                slug={slug}
                wave={maxWave}
                pipelineSteps={state.pipelineSteps ?? {}}
                onRetryStep={async (step, wave) => { await retryStep(slug, step, wave) }}
                onSkipStep={async (step, wave, reason) => { await skipStep(slug, step, wave, reason) }}
                onForceComplete={async () => { await forceMarkComplete(slug) }}
                onRetryFinalize={async () => { onRetryFinalize() }}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-4">Press Escape to close this panel</p>
        </div>
      )}

      {/* Inline banner when waves are showing */}
      {state.waves.length > 0 && (
        <>
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-800 text-sm dark:bg-red-950 dark:border-red-800 dark:text-red-400 flex items-center justify-between gap-2">
            <span><span className="font-medium">Wave failed:</span> {state.runFailed}</span>
            {state.runFailed?.includes('FinalizeWave') && (
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={onRetryFinalize}
                  className="text-xs font-medium px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                >
                  &#x21BA; Retry
                </button>
                <button
                  onClick={onFixBuild}
                  disabled={state.fixBuildStatus === 'running'}
                  className="text-xs font-medium px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {state.fixBuildStatus === 'running' ? 'Fixing\u2026' : '\u2726 Fix with AI'}
                </button>
              </div>
            )}
          </div>
          {Object.keys(state.pipelineSteps ?? {}).length > 0 && (
            <RecoveryControlsPanel
              slug={slug}
              wave={maxWave}
              pipelineSteps={state.pipelineSteps ?? {}}
              onRetryStep={async (step, wave) => { await retryStep(slug, step, wave) }}
              onSkipStep={async (step, wave, reason) => { await skipStep(slug, step, wave, reason) }}
              onForceComplete={async () => { await forceMarkComplete(slug) }}
              onRetryFinalize={async () => { onRetryFinalize() }}
            />
          )}
        </>
      )}
    </>
  )
}
