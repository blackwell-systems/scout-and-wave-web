// LiveRail — right-rail live execution panel
// Stub created by Scaffold Agent. Full implementation by Wave 1 Agent D.

import { useEffect } from 'react'
import ScoutLauncher from './ScoutLauncher'
import WaveBoard from './WaveBoard'
import PlannerLauncher from './PlannerLauncher'
import { X } from 'lucide-react'

export type LiveView = null | 'scout' | 'wave' | 'planner'

export interface LiveRailProps {
  slug: string | null
  liveView: LiveView
  widthPx: number
  onScoutComplete: (slug: string) => void
  onScoutReady?: () => void
  onPlannerComplete?: (slug: string) => void
  onClose: () => void
  repos?: import('../types').RepoEntry[]
  activeRepo?: import('../types').RepoEntry | null
  onRepoSwitch?: (index: number) => void
  /** Optional callback to start a new scout after wave completion.
   *  App.tsx should wire this as: onRescout={() => setLiveView('scout')} */
  onRescout?: () => void
}

export default function LiveRail({ slug, liveView, onScoutComplete, onScoutReady, onPlannerComplete, onClose, repos, activeRepo, onRescout }: LiveRailProps): JSX.Element {

  // Escape key handler to close the rail
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape' && liveView !== null) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [liveView, onClose])

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Rail header */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <span className="text-xs font-medium text-muted-foreground">
          {liveView === 'planner' ? 'New Program' : liveView === 'scout' ? 'New Plan' : liveView === 'wave' ? 'Wave Execution' : ''}
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Close rail"
        >
          <X size={14} />
        </button>
      </div>

      {/* Planner view */}
      {liveView === 'planner' && (
        <div className="flex-1 overflow-y-auto">
          <PlannerLauncher onComplete={slug => { onPlannerComplete?.(slug) }} repos={repos} activeRepo={activeRepo} />
        </div>
      )}

      {/* Scout view */}
      {liveView === 'scout' && (
        <div className="flex-1 overflow-y-auto">
          <ScoutLauncher onComplete={onScoutComplete} onScoutReady={onScoutReady} repos={repos} activeRepo={activeRepo} />
        </div>
      )}

      {/* Wave view */}
      {liveView === 'wave' && slug && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <WaveBoard slug={slug} compact={true} repos={repos} onRescout={onRescout} />
        </div>
      )}

      {/* Idle state */}
      {liveView === null && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Select an action to begin.
        </div>
      )}
    </div>
  )
}
