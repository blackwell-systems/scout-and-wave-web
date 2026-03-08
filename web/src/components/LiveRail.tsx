// LiveRail — right-rail live execution panel
// Stub created by Scaffold Agent. Full implementation by Wave 1 Agent D.

import { useGitActivity } from '../hooks/useGitActivity'
import ScoutLauncher from './ScoutLauncher'
import WaveBoard from './WaveBoard'
import GitActivitySidebar from './git/GitActivitySidebar'
import { X } from 'lucide-react'

export type LiveView = null | 'scout' | 'wave'

export interface LiveRailProps {
  slug: string | null
  liveView: LiveView
  widthPx: number
  onScoutComplete: (slug: string) => void
  onScoutReady?: () => void
  onClose: () => void
  repos?: import('../types').RepoEntry[]
  activeRepo?: import('../types').RepoEntry | null
  onRepoSwitch?: (index: number) => void
}

export default function LiveRail({ slug, liveView, onScoutComplete, onScoutReady, onClose }: LiveRailProps): JSX.Element {
  const gitSnapshot = useGitActivity(liveView === 'wave' && slug ? slug : '')

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Rail header */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <span className="text-xs font-medium text-muted-foreground">
          {liveView === 'scout' ? 'New Plan' : liveView === 'wave' ? 'Wave Execution' : ''}
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Close rail"
        >
          <X size={14} />
        </button>
      </div>

      {/* Scout view */}
      {liveView === 'scout' && (
        <div className="flex-1 overflow-y-auto">
          <ScoutLauncher onComplete={onScoutComplete} onScoutReady={onScoutReady} />
        </div>
      )}

      {/* Wave view */}
      {liveView === 'wave' && slug && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto min-h-0">
            <WaveBoard slug={slug} compact={true} />
          </div>
          <div className="border-t shrink-0 p-3">
            <h2 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Git Activity</h2>
            <GitActivitySidebar slug={slug} snapshot={gitSnapshot} />
          </div>
        </div>
      )}

      {/* Idle state */}
      {liveView === null && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          No active execution.
        </div>
      )}
    </div>
  )
}
