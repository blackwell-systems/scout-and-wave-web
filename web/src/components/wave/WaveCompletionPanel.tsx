import type { AppWaveState } from '../../hooks/useWaveEvents'

export interface WaveCompletionPanelProps {
  state: AppWaveState
  totalAgents: number
  onRescout?: () => void
}

/** Run-complete banner showing success summary and optional next action. */
export function WaveCompletionPanel({ state, totalAgents, onRescout }: WaveCompletionPanelProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center mb-4">
        <span className="text-green-600 dark:text-green-400 text-2xl">&#x2713;</span>
      </div>
      <h2 className="text-base font-semibold text-green-800 dark:text-green-300 mb-1">
        IMPL Complete
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        {state.waves.length} {state.waves.length === 1 ? 'wave' : 'waves'}, {totalAgents} {totalAgents === 1 ? 'agent' : 'agents'} — all merged and verified
      </p>
      <p className="text-xs text-muted-foreground mb-4 max-w-xs">
        Your changes are on the current branch. Review the diff, run your test
        suite, and open the Post-Merge Checklist in the plan review for next steps.
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
  )
}
