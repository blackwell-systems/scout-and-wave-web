import { IMPLDocResponse } from '../../types'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

interface WaveStructurePanelProps {
  impl: IMPLDocResponse
}

const AGENT_COLORS: Record<string, string> = {
  A: 'bg-blue-500 text-white',
  B: 'bg-purple-500 text-white',
  C: 'bg-orange-500 text-white',
  D: 'bg-teal-500 text-white',
  E: 'bg-pink-500 text-white',
  F: 'bg-green-500 text-white',
}

export default function WaveStructurePanel({ impl }: WaveStructurePanelProps): JSX.Element {
  const sortedWaves = [...impl.waves].sort((a, b) => a.number - b.number)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wave Structure</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Scout phase */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-20 h-10 bg-green-500/10 border-2 border-green-500/30 rounded text-sm font-semibold text-green-700 dark:text-green-300">
              Scout
            </div>
            <div className="flex-1 h-0.5 bg-gradient-to-r from-green-500/30 to-transparent" />
          </div>

          {/* Scaffold if needed */}
          {impl.scaffold.required && (
            <div className="flex items-center gap-3 ml-8">
              <div className="flex items-center justify-center w-20 h-10 bg-amber-500/10 border-2 border-amber-500/30 rounded text-sm font-semibold text-amber-700 dark:text-amber-300">
                Scaffold
              </div>
              <div className="flex-1 h-0.5 bg-gradient-to-r from-amber-500/30 to-transparent" />
            </div>
          )}

          {/* Waves */}
          {sortedWaves.map(wave => (
            <div key={wave.number} className="space-y-3">
              {/* Wave header */}
              <div className="flex items-center gap-3 ml-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Wave {wave.number}
                </div>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* Agent cards in horizontal row */}
              <div className="flex flex-wrap gap-3 ml-8">
                {wave.agents.map(agentLetter => (
                  <div
                    key={agentLetter}
                    className={`flex items-center justify-center w-12 h-12 rounded-lg font-bold text-lg shadow-sm ${
                      AGENT_COLORS[agentLetter] || 'bg-gray-500 text-white'
                    }`}
                  >
                    {agentLetter}
                  </div>
                ))}
              </div>

              {/* Merge indicator */}
              <div className="flex items-center gap-3 ml-4">
                <div className="text-xs text-muted-foreground">→ merge & verify</div>
                <div className="flex-1 h-px bg-border" />
              </div>
            </div>
          ))}

          {/* Complete */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-20 h-10 bg-gray-500/10 border-2 border-gray-500/30 rounded text-sm font-semibold text-gray-700 dark:text-gray-300">
              Complete
            </div>
          </div>
        </div>

        {/* Stats footer */}
        <div className="mt-6 pt-4 border-t text-xs text-muted-foreground">
          {sortedWaves.reduce((sum, w) => sum + w.agents.length, 0)} agents across {sortedWaves.length} {sortedWaves.length === 1 ? 'wave' : 'waves'}
        </div>
      </CardContent>
    </Card>
  )
}
