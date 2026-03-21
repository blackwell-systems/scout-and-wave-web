import React from 'react'
import { Play, Eye, Pencil, X, ShieldCheck, Loader2 } from 'lucide-react'
import { Tooltip } from './ui/tooltip'
import type { CriticResult } from '../types'

interface ActionButtonsProps {
  onApprove: () => void
  onReject: () => void
  onRequestChanges: () => void
  onViewWaves?: () => void
  hasWaveWork?: boolean
  needsCritic?: boolean
  criticReport?: CriticResult | null
  criticRunning?: boolean
  onRunCritic?: () => void
}

const base = "flex items-center justify-center gap-2 text-sm font-medium px-6 h-14 transition-all duration-150 border-t-2 hover:scale-[1.02] active:scale-[0.98]"

export default React.memo(function ActionButtons({ onApprove, onReject, onRequestChanges, onViewWaves, hasWaveWork, needsCritic, criticReport, criticRunning, onRunCritic }: ActionButtonsProps): JSX.Element {
  const criticHasIssues = criticReport && criticReport.verdict !== 'PASS'
  const showCriticButton = needsCritic && !criticReport && !hasWaveWork

  return (
    <div className="flex items-stretch">
      {hasWaveWork && onViewWaves && (
        <button onClick={onViewWaves} className={`${base} border-t-blue-500 text-blue-700 dark:text-blue-400 hover:bg-blue-500/10 active:bg-blue-500/20`}>
          <Eye className="w-4 h-4" />
          <Tooltip content="Live dashboard showing agent progress, logs, and completion status for the current wave execution." position="top">
            <span>View WaveBoard</span>
          </Tooltip>
        </button>
      )}
      {showCriticButton ? (
        <button
          onClick={onRunCritic}
          disabled={criticRunning}
          className={`${base} border-t-violet-500 text-violet-700 dark:text-violet-400 hover:bg-violet-500/10 active:bg-violet-500/20 disabled:opacity-50`}
        >
          {criticRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          <Tooltip content="Run the critic agent (E37) to verify all agent briefs before execution. Required for IMPLs with 3+ wave-1 agents or multi-repo ownership." position="top">
            <span>{criticRunning ? 'Reviewing Briefs...' : 'Review Briefs'}</span>
          </Tooltip>
        </button>
      ) : (
        <button onClick={onApprove} className={`${base} border-t-green-500 text-green-700 dark:text-green-400 hover:bg-green-500/10 active:bg-green-500/20`}>
          <Play className="w-4 h-4" />
          <Tooltip content={criticHasIssues
            ? "Critic found issues but you can still approve. Review the critic report above first."
            : "Launches Wave 1 agents in parallel. Each agent works in an isolated git worktree. Scaffolds are created first if needed (I2)."
          } position="top">
            <span>Approve</span>
          </Tooltip>
        </button>
      )}
      <button onClick={onRequestChanges} className={`${base} border-t-amber-500 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 active:bg-amber-500/20`}>
        <Pencil className="w-4 h-4" />
        <Tooltip content="Edit the IMPL doc before execution. Adjust agent briefs, file ownership, interface contracts, or wave structure." position="top">
          <span>Request Changes</span>
        </Tooltip>
      </button>
      <button onClick={onReject} className={`${base} border-t-red-500 text-red-700 dark:text-red-400 hover:bg-red-500/10 active:bg-red-500/20`}>
        <X className="w-4 h-4" />
        <Tooltip content="Reject this plan entirely. The IMPL doc will be archived and no agents will be launched." position="top">
          <span>Reject</span>
        </Tooltip>
      </button>
    </div>
  )
})
