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

const JEWEL_CONFIGS: Record<NodeType, { size: number; colors: [string, string, string] }> = {
  wave: { size: 20, colors: ['#60a5fa', '#3b82f6', '#1d4ed8'] },
  complete: { size: 20, colors: ['#a78bfa', '#7c3aed', '#5b21b6'] },
  merge: { size: 12, colors: ['#94a3b8', '#64748b', '#475569'] },
  orchestrator: { size: 12, colors: ['#94a3b8', '#64748b', '#475569'] },
}

function Jewel({ type, filled }: { type: NodeType; filled: boolean }) {
  const config = JEWEL_CONFIGS[type]
  const { size, colors } = config
  const id = `jewel-${type}-${filled ? 'f' : 'h'}`
  const r = size / 2

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
      <defs>
        <radialGradient id={`${id}-grad`} cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor={filled ? colors[0] : colors[1]} stopOpacity={filled ? 0.9 : 0.3} />
          <stop offset="60%" stopColor={colors[1]} stopOpacity={filled ? 0.7 : 0.15} />
          <stop offset="100%" stopColor={colors[2]} stopOpacity={filled ? 0.5 : 0.05} />
        </radialGradient>
        <radialGradient id={`${id}-highlight`} cx="30%" cy="25%" r="40%">
          <stop offset="0%" stopColor="white" stopOpacity={filled ? 0.6 : 0.3} />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-glow`}>
          <feGaussianBlur stdDeviation={filled ? 2 : 1} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Outer glow */}
      <circle cx={r} cy={r} r={r - 1} fill={colors[1]} opacity={filled ? 0.2 : 0.08} filter={`url(#${id}-glow)`} />
      {/* Body */}
      <circle cx={r} cy={r} r={r - 1.5} fill={`url(#${id}-grad)`} stroke={colors[1]} strokeWidth={filled ? 1 : 0.75} strokeOpacity={filled ? 0.6 : 0.4} />
      {/* Inner highlight */}
      <circle cx={r} cy={r} r={r - 2.5} fill={`url(#${id}-highlight)`} />
      {/* Ring for complete type */}
      {type === 'complete' && (
        <circle cx={r} cy={r} r={r - 0.5} fill="none" stroke={colors[0]} strokeWidth="0.5" strokeOpacity={filled ? 0.4 : 0.2} />
      )}
    </svg>
  )
}

export default function WaveStructurePanel({ impl }: WaveStructurePanelProps): JSX.Element {
  const sortedWaves = [...impl.waves].sort((a, b) => a.number - b.number)
  const isComplete = impl.doc_status === 'COMPLETE'

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
          <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border" />

          {nodes.map((node, i) => (
            <div key={i} className={`relative ${i > 0 ? (node.type === 'wave' ? 'mt-6' : 'mt-4') : ''}`}>
              {/* Dot on rail */}
              <div className="absolute -left-8 flex items-center justify-center w-5" style={{ top: node.type === 'wave' ? 14 : 2 }}>
                <Jewel type={node.type} filled={isComplete} />
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
