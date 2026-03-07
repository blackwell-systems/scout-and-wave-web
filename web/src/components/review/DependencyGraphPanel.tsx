import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

interface DependencyGraphPanelProps {
  dependencyGraphText?: string
}

interface ParsedWave {
  number: number
  agents: Array<{
    letter: string
    description: string
    dependencies: string[]
  }>
}

function parseDependencyGraph(text: string): ParsedWave[] {
  const waves: ParsedWave[] = []
  const lines = text.split('\n')
  let currentWave: ParsedWave | null = null
  let currentAgent: { letter: string; description: string; dependencies: string[] } | null = null

  for (const line of lines) {
    // Wave N header
    const waveMatch = line.match(/^Wave (\d+)/i)
    if (waveMatch) {
      if (currentWave && currentAgent) {
        currentWave.agents.push(currentAgent)
      }
      if (currentWave) {
        waves.push(currentWave)
      }
      currentWave = { number: parseInt(waveMatch[1]), agents: [] }
      currentAgent = null
      continue
    }

    // [A] or [B] agent blocks
    const agentMatch = line.match(/^\s*\[([A-Z])\]\s*(.+)/)
    if (agentMatch && currentWave) {
      if (currentAgent) {
        currentWave.agents.push(currentAgent)
      }
      currentAgent = {
        letter: agentMatch[1],
        description: agentMatch[2].trim(),
        dependencies: []
      }
      continue
    }

    // Dependency arrows (depends on: [A])
    if (currentAgent && line.includes('depends on:')) {
      const depMatch = line.match(/\[([A-Z])\]/)
      if (depMatch) {
        currentAgent.dependencies.push(depMatch[1])
      }
    }
  }

  // Flush remaining
  if (currentAgent && currentWave) {
    currentWave.agents.push(currentAgent)
  }
  if (currentWave) {
    waves.push(currentWave)
  }

  return waves
}

export default function DependencyGraphPanel({ dependencyGraphText }: DependencyGraphPanelProps): JSX.Element {
  if (!dependencyGraphText || dependencyGraphText.trim() === '') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dependency Graph</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No dependency graph</p>
        </CardContent>
      </Card>
    )
  }

  const parsed = parseDependencyGraph(dependencyGraphText)

  // If parsing failed, fall back to raw text
  if (parsed.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dependency Graph</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-4 rounded border">
            {dependencyGraphText}
          </pre>
        </CardContent>
      </Card>
    )
  }

  const agentColors: Record<string, string> = {
    A: 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300',
    B: 'bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300',
    C: 'bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-300',
    D: 'bg-teal-500/10 border-teal-500/30 text-teal-700 dark:text-teal-300',
    E: 'bg-pink-500/10 border-pink-500/30 text-pink-700 dark:text-pink-300',
    F: 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300',
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dependency Graph</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-8">
          {parsed.map(wave => (
            <div key={wave.number}>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                Wave {wave.number}
              </div>
              <div className="flex flex-wrap gap-4">
                {wave.agents.map(agent => (
                  <div key={agent.letter} className="flex-1 min-w-[200px]">
                    <div className={`border-2 rounded-lg p-4 ${agentColors[agent.letter] || agentColors.A}`}>
                      <div className="font-bold text-sm mb-2">Agent {agent.letter}</div>
                      <div className="text-xs mb-3">{agent.description}</div>
                      {agent.dependencies.length > 0 && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>↑ depends on:</span>
                          {agent.dependencies.map(dep => (
                            <span key={dep} className="font-mono font-semibold">
                              [{dep}]
                            </span>
                          ))}
                        </div>
                      )}
                      {agent.dependencies.length === 0 && (
                        <div className="text-xs text-muted-foreground">
                          ✓ no dependencies (root)
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-6 pt-4 border-t text-xs text-muted-foreground">
          <span className="font-semibold">Roots:</span> Agents with no dependencies can run immediately.{' '}
          <span className="font-semibold">Leaves:</span> Agents with no downstream dependents.
        </div>
      </CardContent>
    </Card>
  )
}
