import { useState } from 'react'

interface RecoveryControlsPanelProps {
  slug: string
  wave: number
  pipelineSteps: Record<string, { status: string; error?: string }>
  onRetryStep: (step: string, wave: number) => Promise<void>
  onSkipStep: (step: string, wave: number, reason: string) => Promise<void>
  onForceComplete: () => Promise<void>
  onRetryFinalize: () => Promise<void>
}

const STEP_ORDER = [
  'verify_commits',
  'scan_stubs',
  'run_gates',
  'validate_integration',
  'merge_agents',
  'fix_go_mod',
  'verify_build',
  'cleanup',
]

const SKIPPABLE_STEPS = new Set([
  'scan_stubs',
  'validate_integration',
  'run_gates',
  'cleanup',
  'fix_go_mod',
])

const STEP_LABELS: Record<string, string> = {
  verify_commits: 'Verify Commits',
  scan_stubs: 'Scan Stubs',
  run_gates: 'Run Gates',
  validate_integration: 'Validate Integration',
  merge_agents: 'Merge Agents',
  fix_go_mod: 'Fix Go Mod',
  verify_build: 'Verify Build',
  cleanup: 'Cleanup',
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'complete':
      return <span className="text-green-600 dark:text-green-400">&#x2713;</span>
    case 'failed':
      return <span className="text-red-600 dark:text-red-400">&#x2717;</span>
    case 'running':
      return <span className="text-blue-500 dark:text-blue-400 animate-pulse">&#x25CF;</span>
    case 'skipped':
      return <span className="text-yellow-500 dark:text-yellow-400">&#x2192;</span>
    default:
      return <span className="text-gray-400 dark:text-gray-600">&#x2014;</span>
  }
}

export default function RecoveryControlsPanel({
  slug: _slug,
  wave,
  pipelineSteps,
  onRetryStep,
  onSkipStep,
  onForceComplete,
  onRetryFinalize,
}: RecoveryControlsPanelProps): JSX.Element {
  const [loadingStep, setLoadingStep] = useState<string | null>(null)
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({})
  const [forceCompleting, setForceCompleting] = useState(false)
  const [retryingFinalize, setRetryingFinalize] = useState(false)

  // If no pipeline steps, render nothing
  if (Object.keys(pipelineSteps).length === 0) {
    return <></>
  }

  async function handleRetry(step: string) {
    setLoadingStep(step)
    setStepErrors(prev => {
      const next = { ...prev }
      delete next[step]
      return next
    })
    try {
      await onRetryStep(step, wave)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('409') || msg.includes('already in progress') || msg.includes('Already in progress')) {
        setStepErrors(prev => ({ ...prev, [step]: 'Already in progress' }))
      } else {
        setStepErrors(prev => ({ ...prev, [step]: msg }))
      }
    } finally {
      setLoadingStep(null)
    }
  }

  async function handleSkip(step: string) {
    setLoadingStep(step)
    setStepErrors(prev => {
      const next = { ...prev }
      delete next[step]
      return next
    })
    try {
      await onSkipStep(step, wave, `Manually skipped by user`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('409') || msg.includes('already in progress') || msg.includes('Already in progress')) {
        setStepErrors(prev => ({ ...prev, [step]: 'Already in progress' }))
      } else {
        setStepErrors(prev => ({ ...prev, [step]: msg }))
      }
    } finally {
      setLoadingStep(null)
    }
  }

  async function handleForceComplete() {
    if (!window.confirm('Are you sure you want to force mark this IMPL as complete? This skips all remaining pipeline steps.')) {
      return
    }
    setForceCompleting(true)
    try {
      await onForceComplete()
    } catch {
      // Parent handles errors
    } finally {
      setForceCompleting(false)
    }
  }

  async function handleRetryFinalize() {
    setRetryingFinalize(true)
    try {
      await onRetryFinalize()
    } catch {
      // Parent handles errors
    } finally {
      setRetryingFinalize(false)
    }
  }

  return (
    <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-3 dark:bg-red-950 dark:border-red-800">
      <p className="text-red-800 text-sm font-medium dark:text-red-400">
        Recovery Controls
      </p>

      <ul className="space-y-2 text-xs">
        {STEP_ORDER.map(step => {
          const state = pipelineSteps[step] ?? { status: 'pending' }
          const isFailed = state.status === 'failed'
          const isLoading = loadingStep === step
          const error = stepErrors[step]

          return (
            <li key={step} className="flex items-start gap-2">
              <span className="mt-0.5 w-4 text-center flex-shrink-0">
                <StatusIcon status={state.status} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`font-mono ${
                    state.status === 'complete'
                      ? 'text-green-700 dark:text-green-300'
                      : state.status === 'failed'
                      ? 'text-red-700 dark:text-red-300 font-medium'
                      : state.status === 'running'
                      ? 'text-blue-700 dark:text-blue-300'
                      : state.status === 'skipped'
                      ? 'text-yellow-700 dark:text-yellow-300'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}>
                    {STEP_LABELS[step] ?? step}
                  </span>

                  {isFailed && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRetry(step)}
                        disabled={isLoading}
                        className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50 dark:bg-blue-900 dark:text-blue-300 dark:hover:bg-blue-800"
                      >
                        {isLoading ? 'Retrying...' : 'Retry'}
                      </button>
                      {SKIPPABLE_STEPS.has(step) && (
                        <button
                          onClick={() => handleSkip(step)}
                          disabled={isLoading}
                          className="px-2 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700 hover:bg-yellow-200 disabled:opacity-50 dark:bg-yellow-900 dark:text-yellow-300 dark:hover:bg-yellow-800"
                        >
                          Skip
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {state.error && (
                  <p className="text-red-600 text-xs mt-0.5 dark:text-red-400 break-words">
                    {state.error}
                  </p>
                )}

                {error && (
                  <p className={`text-xs mt-0.5 break-words ${
                    error === 'Already in progress'
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {error}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <div className="flex items-center gap-2 pt-2 border-t border-red-200 dark:border-red-800">
        <button
          onClick={handleRetryFinalize}
          disabled={retryingFinalize}
          className="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-700 dark:hover:bg-blue-600"
        >
          {retryingFinalize ? 'Retrying...' : 'Retry Full Finalization'}
        </button>
        <button
          onClick={handleForceComplete}
          disabled={forceCompleting}
          className="px-3 py-1.5 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-600"
        >
          {forceCompleting ? 'Completing...' : 'Force Mark Complete'}
        </button>
      </div>
    </div>
  )
}
