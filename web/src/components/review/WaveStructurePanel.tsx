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

type NodeType = 'orchestrator' | 'wave' | 'merge' | 'complete'

interface TimelineNode {
  type: NodeType
  label: string
  description?: string
  agents?: string[]
  agentCount?: number
}

function TimelineDot({ type }: { type: NodeType }) {
  switch (type) {
    case 'wave':
      return (
        <div className="w-4 h-4 rounded-full bg-primary border-2 border-primary shadow-sm shadow-primary/30" />
      )
    case 'merge':
      return (
        <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/40" />
      )
    case 'complete':
      return (
        <div className="w-4 h-4 rounded-full bg-primary border-2 border-primary ring-2 ring-primary/20" />
      )
    default:
      return (
        <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/40" />
      )
  }
}

export default function WaveStructurePanel({ impl }: WaveStructurePanelProps): JSX.Element {
  const sortedWaves = [...impl.waves].sort((a, b) => a.number - b.number)

  // Build timeline nodes
  const nodes: TimelineNode[] = []

  nodes.push({ type: 'orchestrator', label: 'Scout', description: 'Analyze codebase and produce IMPL doc' })

  if (impl.scaffold.required) {
    nodes.push({
      type: 'orchestrator',
      label: 'Scaffold',
      description: `Create ${impl.scaffold.files.length} interface ${impl.scaffold.files.length === 1 ? 'file' : 'files'}`,
    })
  }

  sortedWaves.forEach((wave, i) => {
    nodes.push({
      type: 'wave',
      label: `Wave ${wave.number}`,
      agents: wave.agents,
      agentCount: wave.agents.length,
    })
    nodes.push({
      type: 'merge',
      label: 'Merge',
      description: i < sortedWaves.length - 1
        ? `Merge ${wave.agents.length} branches, verify, gate Wave ${wave.number + 1}`
        : `Merge ${wave.agents.length} branches, final verification`,
    })
  })

  nodes.push({ type: 'complete', label: 'Complete', description: 'All waves merged and verified' })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wave Structure</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative pl-8">
          {/* Vertical rail */}
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

          {nodes.map((node, i) => (
            <div key={i} className={`relative ${i > 0 ? (node.type === 'wave' ? 'mt-6' : 'mt-4') : ''}`}>
              {/* Dot on rail */}
              <div className="absolute -left-8 flex items-center justify-center" style={{ top: node.type === 'wave' ? 14 : 2, width: 16 }}>
                <TimelineDot type={node.type} />
              </div>

              {node.type === 'wave' ? (
                <div>
                  <div className="text-sm font-semibold text-foreground mb-2">{node.label}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {node.agents?.map(agentLetter => (
                      <div
                        key={agentLetter}
                        className={`flex items-center justify-center w-12 h-12 rounded-lg font-semibold text-base ${
                          AGENT_COLORS[agentLetter] || 'bg-gray-500/10 border-2 border-gray-500/30 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {agentLetter}
                      </div>
                    ))}
                    <span className="text-xs text-muted-foreground ml-1">
                      {node.agentCount} parallel
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-baseline gap-2">
                  <span className={`text-sm font-semibold ${node.type === 'complete' ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {node.label}
                  </span>
                  {node.description && (
                    <span className="text-xs text-muted-foreground">{node.description}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
