import { useState } from 'react'
import { IMPLDocResponse } from '../../types'
import { Tooltip } from '../ui/tooltip'

interface OverviewPanelProps {
  impl: IMPLDocResponse
}

export default function OverviewPanel({ impl }: OverviewPanelProps): JSX.Element {
  const [showRationale, setShowRationale] = useState(false)
  const fileCount = impl.file_ownership.length
  const agentSet = new Set(impl.file_ownership.map(e => e.agent))
  const agentCount = agentSet.size
  const waveCount = impl.waves.length
  const verdict = impl.suitability.verdict
  const rationale = impl.suitability.rationale

  const verdictColor = verdict === 'SUITABLE'
    ? 'text-green-600 dark:text-green-400'
    : verdict === 'SUITABLE WITH CAVEATS'
      ? 'text-yellow-600 dark:text-yellow-400'
      : 'text-red-600 dark:text-red-400'

  return (
    <div className="border-b pb-2 mb-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <button
          onClick={() => rationale && setShowRationale(v => !v)}
          className={`font-medium ${verdictColor} ${rationale ? 'cursor-pointer hover:underline' : ''}`}
        >
          {verdict === 'SUITABLE' ? (
            <Tooltip content="Scout verified this work can be parallelized. All agents have disjoint file ownership (I1) and interface contracts are defined (I2).">
              <span className="underline decoration-dotted">{verdict}</span>
            </Tooltip>
          ) : (
            verdict
          )}{rationale ? (showRationale ? ' ▾' : ' ▸') : ''}
        </button>
        <span>·</span>
        <Tooltip content="Number of files that will be created or modified. Each file is owned by exactly one agent (I1 invariant).">
          <span className="underline decoration-dotted">{fileCount} files</span>
        </Tooltip>
        <span>·</span>
        <Tooltip content="Number of parallel agents. Each owns distinct files and implements interface contracts.">
          <span className="underline decoration-dotted">{agentCount} agents</span>
        </Tooltip>
        <span>·</span>
        <Tooltip content="Sequential execution phases. Wave N+1 depends on Wave N's outputs. Agents within a wave run in parallel.">
          <span className="underline decoration-dotted">{waveCount} {waveCount === 1 ? 'wave' : 'waves'}</span>
        </Tooltip>
      </div>
      {showRationale && rationale && (
        <pre className="mt-3 p-3 text-xs leading-relaxed text-muted-foreground bg-muted/50 rounded-md border border-border overflow-x-auto whitespace-pre-wrap font-mono">
          {rationale}
        </pre>
      )}
    </div>
  )
}
