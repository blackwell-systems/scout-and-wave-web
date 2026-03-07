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
        <div className="space-y-3">
          {/* Scout lane */}
          <div className="flex items-center gap-3">
            <div className="w-20 text-sm font-semibold text-muted-foreground">
              Scout
            </div>
            <div className="text-muted-foreground">→</div>
            <div className="flex-1 text-xs text-muted-foreground">
              Analyze codebase
            </div>
          </div>

          {/* Scaffold lane if needed */}
          {impl.scaffold.required && (
            <div className="flex items-center gap-3">
              <div className="w-20 text-sm font-semibold text-muted-foreground">
                Scaffold
              </div>
              <div className="text-muted-foreground">→</div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {impl.scaffold.files.length} {impl.scaffold.files.length === 1 ? 'file' : 'files'}
                </span>
              </div>
            </div>
          )}

          {/* Wave lanes */}
          {sortedWaves.map(wave => (
            <div key={wave.number} className="flex items-center gap-3">
              <div className="w-20 text-sm font-semibold text-foreground">
                Wave {wave.number}
              </div>
              <div className="text-muted-foreground">→</div>
              <div className="flex items-center gap-2 flex-wrap">
                {wave.agents.map(agentLetter => (
                  <div
                    key={agentLetter}
                    className={`flex items-center justify-center w-9 h-9 rounded font-semibold text-sm ${
                      AGENT_COLORS[agentLetter] || 'bg-gray-500/10 border-2 border-gray-500/30 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {agentLetter}
                  </div>
                ))}
                <span className="text-xs text-muted-foreground ml-2">
                  ({wave.agents.length} {wave.agents.length === 1 ? 'agent' : 'agents'} parallel)
                </span>
              </div>
            </div>
          ))}

          {/* Complete lane */}
          <div className="flex items-center gap-3">
            <div className="w-20 text-sm font-semibold text-muted-foreground">
              Complete
            </div>
            <div className="text-green-600 dark:text-green-400">✓</div>
            <div className="flex-1 text-xs text-muted-foreground">
              All waves merged and verified
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
