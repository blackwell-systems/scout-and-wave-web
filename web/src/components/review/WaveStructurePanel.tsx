import { IMPLDocResponse } from '../../types'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

interface WaveStructurePanelProps {
  impl: IMPLDocResponse
}

const AGENT_COLORS: Record<string, string> = {
  A: 'bg-blue-500/10 border-2 border-blue-500/30 text-blue-700 dark:text-blue-300',
  B: 'bg-purple-500/10 border-2 border-purple-500/30 text-purple-700 dark:text-purple-300',
  C: 'bg-orange-500/10 border-2 border-orange-500/30 text-orange-700 dark:text-orange-300',
  D: 'bg-teal-500/10 border-2 border-teal-500/30 text-teal-700 dark:text-teal-300',
  E: 'bg-pink-500/10 border-2 border-pink-500/30 text-pink-700 dark:text-pink-300',
  F: 'bg-green-500/10 border-2 border-green-500/30 text-green-700 dark:text-green-300',
  G: 'bg-indigo-500/10 border-2 border-indigo-500/30 text-indigo-700 dark:text-indigo-300',
  H: 'bg-rose-500/10 border-2 border-rose-500/30 text-rose-700 dark:text-rose-300',
  I: 'bg-cyan-500/10 border-2 border-cyan-500/30 text-cyan-700 dark:text-cyan-300',
  J: 'bg-amber-500/10 border-2 border-amber-500/30 text-amber-700 dark:text-amber-300',
  K: 'bg-lime-500/10 border-2 border-lime-500/30 text-lime-700 dark:text-lime-300',
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
                    className={`flex items-center justify-center w-12 h-12 rounded-lg font-semibold text-base ${
                      AGENT_COLORS[agentLetter] || 'bg-gray-500/10 border-2 border-gray-500/30 text-gray-700 dark:text-gray-300'
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
