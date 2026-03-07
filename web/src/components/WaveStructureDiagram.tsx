import { WaveInfo, ScaffoldInfo } from '../types'

interface WaveStructureDiagramProps {
  waves: WaveInfo[]
  scaffold: ScaffoldInfo
}

function AgentBadge({ name }: { name: string }): JSX.Element {
  return (
    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
      {name}
    </span>
  )
}

function ScaffoldBadge(): JSX.Element {
  return (
    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
      scaffold agent
    </span>
  )
}

function DownArrow(): JSX.Element {
  return (
    <div className="flex justify-center my-1">
      <svg className="w-5 h-5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  )
}

export default function WaveStructureDiagram({ waves, scaffold }: WaveStructureDiagramProps): JSX.Element {
  const sortedWaves = [...waves].sort((a, b) => a.number - b.number)

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-3">Wave Structure</h2>
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-900">
        {scaffold.required && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-20 shrink-0">Scaffold</span>
              <div className="flex flex-wrap gap-2">
                <ScaffoldBadge />
              </div>
            </div>
            {sortedWaves.length > 0 && <DownArrow />}
          </>
        )}

        {sortedWaves.map((wave, idx) => (
          <div key={wave.number}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-20 shrink-0">
                Wave {wave.number}
              </span>
              <div className="flex flex-wrap gap-2">
                {wave.agents.map(agent => (
                  <AgentBadge key={agent} name={agent} />
                ))}
              </div>
            </div>
            {idx < sortedWaves.length - 1 && <DownArrow />}
          </div>
        ))}

        {sortedWaves.length === 0 && !scaffold.required && (
          <p className="text-sm text-gray-400 dark:text-gray-500">No waves defined.</p>
        )}
      </div>
    </div>
  )
}
