import { WaveInfo, ScaffoldInfo } from '../types'

interface WaveStructureDiagramProps {
  waves: WaveInfo[]
  scaffold: ScaffoldInfo
}

const AGENT_COLORS = [
  { dot: 'bg-blue-400', text: 'text-blue-700 dark:text-blue-300' },
  { dot: 'bg-purple-400', text: 'text-purple-700 dark:text-purple-300' },
  { dot: 'bg-orange-400', text: 'text-orange-700 dark:text-orange-300' },
  { dot: 'bg-teal-400', text: 'text-teal-700 dark:text-teal-300' },
  { dot: 'bg-pink-400', text: 'text-pink-700 dark:text-pink-300' },
]

function getColor(index: number) {
  return AGENT_COLORS[index % AGENT_COLORS.length]
}

// Single node on the trunk (scout, merge points)
function TrunkNode({ label, icon, muted }: { label: string; icon: string; muted?: boolean }): JSX.Element {
  return (
    <div className="flex items-center gap-3 relative">
      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[8px] shrink-0 ${
        muted
          ? 'border-gray-400 dark:border-gray-500 bg-gray-100 dark:bg-gray-800'
          : 'border-green-500 dark:border-green-400 bg-green-100 dark:bg-green-900'
      }`}>
        {icon}
      </div>
      <span className={`text-sm font-medium ${
        muted ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-200'
      }`}>{label}</span>
    </div>
  )
}

// Vertical trunk line segment
function TrunkLine({ height = 'h-6' }: { height?: string }): JSX.Element {
  return (
    <div className="flex">
      <div className={`w-4 flex justify-center shrink-0`}>
        <div className={`w-0.5 ${height} bg-gray-300 dark:bg-gray-600`} />
      </div>
    </div>
  )
}

// Branch lines fanning out from trunk to agents
function BranchGroup({ agents, globalIndex }: { agents: string[]; globalIndex: number }): JSX.Element {
  return (
    <div className="ml-2">
      {agents.map((agent, i) => {
        const color = getColor(globalIndex + i)
        return (
          <div key={agent} className="flex items-center" style={{ minHeight: '28px' }}>
            {/* Branch line: horizontal from trunk */}
            <div className="w-4 flex justify-center shrink-0">
              <div className="w-0.5 h-full bg-gray-300 dark:bg-gray-600" />
            </div>
            <div className="flex items-center">
              <div className="w-4 h-0.5 bg-gray-300 dark:bg-gray-600" />
              <div className={`w-3 h-3 rounded-full ${color.dot} shrink-0 mx-1.5`} />
              <span className={`text-sm font-mono ${color.text}`}>{agent}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function WaveStructureDiagram({ waves, scaffold }: WaveStructureDiagramProps): JSX.Element {
  const sortedWaves = [...waves].sort((a, b) => a.number - b.number)
  let agentIndex = 0

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-3">Wave Structure</h2>
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-5 bg-white dark:bg-gray-900">

        {sortedWaves.length === 0 && !scaffold.required && (
          <p className="text-sm text-gray-400 dark:text-gray-500">No waves defined.</p>
        )}

        {/* Scout node */}
        {(sortedWaves.length > 0 || scaffold.required) && (
          <>
            <TrunkNode label="Scout" icon="●" />
            <TrunkLine />
          </>
        )}

        {/* Scaffold node */}
        {scaffold.required && (
          <>
            <TrunkNode label="Scaffold" icon="◆" />
            <TrunkLine />
          </>
        )}

        {/* Waves */}
        {sortedWaves.map((wave, idx) => {
          const startIndex = agentIndex
          agentIndex += wave.agents.length
          const isLast = idx === sortedWaves.length - 1

          return (
            <div key={wave.number}>
              {/* Wave label on trunk */}
              <div className="flex items-center gap-3">
                <div className="w-4 flex justify-center shrink-0">
                  <div className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" />
                </div>
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  Wave {wave.number}
                </span>
              </div>

              {/* Agent branches */}
              <BranchGroup agents={wave.agents} globalIndex={startIndex} />

              {/* Merge node after wave */}
              <TrunkLine height="h-4" />
              <TrunkNode
                label={`Merge & verify`}
                icon={isLast ? '○' : '●'}
                muted={isLast}
              />
              {!isLast && <TrunkLine />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
