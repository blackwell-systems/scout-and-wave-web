import { useWaveEvents } from '../hooks/useWaveEvents'
import AgentCard from './AgentCard'
import ProgressBar from './ProgressBar'

interface WaveBoardProps {
  slug: string
}

export default function WaveBoard({ slug }: WaveBoardProps): JSX.Element {
  const state = useWaveEvents(slug)

  const totalAgents = state.agents.length
  const completeAgents = state.agents.filter(a => a.status === 'complete').length

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Wave Execution — {slug}</h1>
          {!state.connected && (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full animate-pulse">
              Reconnecting...
            </span>
          )}
        </div>

        {/* Overall progress bar */}
        {totalAgents > 0 && (
          <ProgressBar complete={completeAgents} total={totalAgents} label="Overall progress" />
        )}

        {/* Run complete banner */}
        {state.runComplete && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-green-800 text-sm font-medium">
            Run complete{state.runStatus ? ` — ${state.runStatus}` : ''}
          </div>
        )}

        {/* Scaffold row */}
        {state.scaffoldStatus !== 'idle' && (
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Scaffold</span>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  state.scaffoldStatus === 'complete'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-blue-100 text-blue-700 animate-pulse'
                }`}
              >
                {state.scaffoldStatus === 'complete' ? 'Complete' : 'Running'}
              </span>
            </div>
          </div>
        )}

        {/* Wave rows */}
        {state.waves.map(wave => {
          const waveComplete = wave.agents.filter(a => a.status === 'complete').length
          const waveTotal = wave.agents.length
          return (
            <div key={wave.wave} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-700 dark:text-gray-300 text-sm">Wave {wave.wave}</span>
                {wave.complete && wave.merge_status && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                    merge: {wave.merge_status}
                  </span>
                )}
              </div>

              {waveTotal > 0 && (
                <ProgressBar complete={waveComplete} total={waveTotal} />
              )}

              <div className="flex flex-wrap gap-3">
                {wave.agents.map(agent => (
                  <AgentCard key={`${agent.agent}-${agent.wave}`} agent={agent} />
                ))}
              </div>
            </div>
          )
        })}

        {/* Empty state */}
        {state.waves.length === 0 && state.scaffoldStatus === 'idle' && (
          <div className="text-center text-gray-400 dark:text-gray-500 text-sm py-12">
            Waiting for wave to start...
          </div>
        )}
      </div>
    </div>
  )
}
