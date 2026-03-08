import { useState } from 'react'
import { IMPLDocResponse } from '../../types'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { getAgentColor, getAgentColorWithOpacity } from '../../lib/agentColors'

interface WaveStructurePanelProps {
  impl: IMPLDocResponse
}

type NodeType = 'orchestrator' | 'wave' | 'scaffold' | 'merge' | 'complete'

interface TimelineNode {
  type: NodeType
  label: string
  description?: string
  agents?: string[]
  agentCount?: number
  scaffoldFiles?: number
}

const JEWEL_CONFIGS: Record<NodeType, { size: number; colors: [string, string, string] }> = {
  wave: { size: 20, colors: ['#93c5fd', '#3b82f6', '#1e40af'] },
  scaffold: { size: 20, colors: ['#fcd34d', '#f59e0b', '#92400e'] },
  complete: { size: 20, colors: ['#c4b5fd', '#7c3aed', '#4c1d95'] },
  merge: { size: 12, colors: ['#cbd5e1', '#64748b', '#334155'] },
  orchestrator: { size: 12, colors: ['#cbd5e1', '#64748b', '#334155'] },
}

let jewelCounter = 0

function Jewel({ type, filled }: { type: NodeType; filled: boolean }) {
  const [uid] = useState(() => `jewel-${++jewelCounter}`)
  const config = JEWEL_CONFIGS[type]
  const { size, colors } = config
  const r = size / 2

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
      <defs>
        <radialGradient id={`${uid}-grad`} cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor={colors[0]} stopOpacity={filled ? 1 : 0.6} />
          <stop offset="50%" stopColor={colors[1]} stopOpacity={filled ? 0.85 : 0.4} />
          <stop offset="100%" stopColor={colors[2]} stopOpacity={filled ? 0.7 : 0.2} />
        </radialGradient>
        <radialGradient id={`${uid}-hl`} cx="30%" cy="25%" r="35%">
          <stop offset="0%" stopColor="white" stopOpacity={filled ? 0.7 : 0.4} />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        {filled && (
          <filter id={`${uid}-glow`}>
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>
      {/* Outer glow — only when filled */}
      {filled && <circle cx={r} cy={r} r={r - 0.5} fill={colors[1]} opacity={0.25} filter={`url(#${uid}-glow)`} />}
      {/* Body */}
      <circle cx={r} cy={r} r={r - 1.5} fill={`url(#${uid}-grad)`} stroke={colors[1]} strokeWidth={1} strokeOpacity={filled ? 0.7 : 0.5} />
      {/* Inner highlight — glassy reflection */}
      <circle cx={r} cy={r} r={r - 2.5} fill={`url(#${uid}-hl)`} />
      {/* Ring for complete type */}
      {type === 'complete' && (
        <circle cx={r} cy={r} r={r - 0.5} fill="none" stroke={colors[0]} strokeWidth="0.75" strokeOpacity={filled ? 0.5 : 0.3} />
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
      type: 'scaffold',
      label: 'Scaffold',
      scaffoldFiles: impl.scaffold.files?.length ?? 0,
    })
  }

  sortedWaves.forEach((wave, i) => {
    const agents = wave.agents ?? []
    nodes.push({
      type: 'wave',
      label: `Wave ${wave.number}`,
      agents,
      agentCount: agents.length,
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
            <div key={i} className={`relative ${i > 0 ? (node.type === 'wave' || node.type === 'scaffold' ? 'mt-6' : 'mt-4') : ''}`}>
              {/* Dot on rail */}
              <div className="absolute -left-8 flex items-center justify-center w-5" style={{ top: node.type === 'wave' || node.type === 'scaffold' ? 14 : 2 }}>
                <Jewel type={node.type} filled={isComplete} />
              </div>

              {node.type === 'wave' ? (
                <div>
                  <div className="text-sm font-semibold text-foreground mb-2">{node.label}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {node.agents?.map(agentLetter => {
                      const color = getAgentColor(agentLetter)
                      const bgColor = getAgentColorWithOpacity(agentLetter, 0.1)
                      return (
                        <div
                          key={agentLetter}
                          className="flex items-center justify-center w-12 h-12 rounded-lg font-semibold text-base border-2"
                          style={{
                            backgroundColor: bgColor,
                            borderColor: `${color}50`,
                            color: color,
                          }}
                        >
                          {agentLetter}
                        </div>
                      )
                    })}
                    <span className="text-xs text-muted-foreground ml-1">
                      {node.agentCount} parallel
                    </span>
                  </div>
                </div>
              ) : node.type === 'scaffold' ? (
                <div>
                  <div className="text-sm font-semibold text-foreground mb-2">{node.label}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div
                      className="flex items-center justify-center w-12 h-12 rounded-lg font-semibold text-base border-2"
                      style={{
                        backgroundColor: 'rgba(100,116,139,0.08)',
                        borderColor: 'rgba(100,116,139,0.3)',
                        color: '#64748b',
                      }}
                    >
                      S
                    </div>
                    <span className="text-xs text-muted-foreground ml-1">
                      {node.scaffoldFiles} interface {node.scaffoldFiles === 1 ? 'file' : 'files'}
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
