import { useRef, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { getAgentColor, resetThemeCache } from '../../lib/agentColors'
import { ExecutionSyncState, AgentExecStatus } from '../../hooks/useExecutionSync'

interface DependencyGraphPanelProps {
  dependencyGraphText?: string
  executionState?: ExecutionSyncState
}

interface ParsedAgent {
  letter: string
  description: string
  dependencies: string[]
  wave: number
}

interface ParsedWave {
  number: number
  agents: ParsedAgent[]
}

function parseDependencyGraph(text: string): ParsedWave[] {
  const waves: ParsedWave[] = []

  // Extract content inside first code fence only (the actual graph)
  const fenceMatch = text.match(/```[\s\S]*?\n([\s\S]*?)```/)
  const graphText = fenceMatch ? fenceMatch[1] : text

  const lines = graphText.split('\n')
  let currentWave: ParsedWave | null = null
  let currentAgent: ParsedAgent | null = null

  for (const line of lines) {
    const waveMatch = line.match(/^Wave (\d+)\s*\(/)
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

    const agentMatch = line.match(/^\s*\[([A-Za-z][A-Za-z0-9]*)\]\s*(.+)/)
    if (agentMatch && currentWave) {
      if (currentAgent) {
        currentWave.agents.push(currentAgent)
      }
      currentAgent = {
        letter: agentMatch[1],
        description: agentMatch[2].trim(),
        dependencies: [],
        wave: currentWave.number,
      }
      continue
    }

    if (currentAgent && line.includes('depends on:')) {
      const deps = [...line.matchAll(/\[([A-Za-z][A-Za-z0-9]*)\]/g)]
      for (const dep of deps) {
        currentAgent.dependencies.push(dep[1])
      }
    }
  }

  if (currentAgent && currentWave) {
    currentWave.agents.push(currentAgent)
  }
  if (currentWave) {
    waves.push(currentWave)
  }

  return waves
}

const NODE_W = 48
const NODE_H = 48
const WAVE_GAP = 160
const AGENT_GAP = 72
const PAD_X = 60
const PAD_Y = 40

function getAgentFill(letter: string): { bg: string; border: string; text: string; dashed?: boolean } {
  if (letter === 'Scaffold') {
    return { bg: '#6b728015', border: '#6b728060', text: '#9ca3af', dashed: true }
  }
  const color = getAgentColor(letter)
  return {
    bg: `${color}20`,
    border: `${color}50`,
    text: color,
  }
}

function getNodeLabel(letter: string): string {
  if (letter === 'Scaffold') return 'Sc'
  return letter
}

// Wave column colors — blends the hues of agents typically in that wave
const WAVE_COLORS = [
  '#3b82f6', // wave 1 — blue
  '#ec4899', // wave 2 — pink
  '#22c55e', // wave 3 — green
  '#f59e0b', // wave 4 — amber
  '#6366f1', // wave 5 — indigo
  '#14b8a6', // wave 6 — teal
]

interface NodePos {
  x: number
  y: number
  agent: ParsedAgent
}

function layoutNodes(waves: ParsedWave[]): { nodes: NodePos[]; width: number; height: number } {
  const nodes: NodePos[] = []
  const maxAgents = Math.max(...waves.map(w => w.agents.length))

  for (let wi = 0; wi < waves.length; wi++) {
    const wave = waves[wi]
    const x = PAD_X + wi * WAVE_GAP
    const totalHeight = (wave.agents.length - 1) * AGENT_GAP
    const startY = PAD_Y + (maxAgents - 1) * AGENT_GAP / 2 - totalHeight / 2

    for (let ai = 0; ai < wave.agents.length; ai++) {
      nodes.push({
        x,
        y: startY + ai * AGENT_GAP,
        agent: wave.agents[ai],
      })
    }
  }

  const width = PAD_X * 2 + (waves.length - 1) * WAVE_GAP + NODE_W
  const height = PAD_Y * 2 + (maxAgents - 1) * AGENT_GAP + NODE_H

  return { nodes, width, height }
}

export default function DependencyGraphPanel({ dependencyGraphText, executionState }: DependencyGraphPanelProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; agent: ParsedAgent } | null>(null)
  const [, setThemeTick] = useState(0)

  const handleMouseLeave = useCallback(() => setTooltip(null), [])

  // Re-render when dark mode or color theme changes so agent colors update
  useEffect(() => {
    const observer = new MutationObserver(() => {
      resetThemeCache()
      setThemeTick(t => t + 1)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  // Close tooltip on scroll
  useEffect(() => {
    const handler = () => setTooltip(null)
    window.addEventListener('scroll', handler, true)
    return () => window.removeEventListener('scroll', handler, true)
  }, [])

  // Helper to look up agent execution status
  function getExecStatus(letter: string, wave: number): AgentExecStatus | undefined {
    if (!executionState || executionState.agents.size === 0) return undefined
    // Scaffold node uses separate scaffoldStatus field
    if (letter === 'Scaffold' && wave === 0) {
      const s = executionState.scaffoldStatus
      if (s === 'idle') return undefined
      return { status: s === 'complete' ? 'complete' : 'running' } as AgentExecStatus
    }
    return executionState.agents.get(`${wave}:${letter}`)
  }

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

  const { nodes, width, height } = layoutNodes(parsed)
  const nodeMap = new Map(nodes.map(n => [n.agent.letter, n]))

  // Find scaffold node (Wave 0)
  const scaffoldNode = nodes.find(n => n.agent.letter === 'Scaffold' && n.agent.wave === 0)
  const hasScaffold = !!scaffoldNode

  // Build cross-wave adjacency for transitive reduction
  const adjMap = new Map<string, Set<string>>()
  for (const node of nodes) {
    const directDeps = new Set<string>()
    for (const dep of node.agent.dependencies) {
      const source = nodeMap.get(dep)
      if (source && source.agent.wave !== node.agent.wave) {
        directDeps.add(dep)
      }
    }

    // Add implicit scaffold dependency for all Wave 1 agents
    if (hasScaffold && node.agent.wave === 1 && node.agent.letter !== 'Scaffold') {
      directDeps.add('Scaffold')
    }

    adjMap.set(node.agent.letter, directDeps)
  }

  // Transitive reduction: drop edge A→C if A can reach C through other nodes
  function isReachableWithout(from: string, target: string, excluded: string): boolean {
    const visited = new Set<string>()
    const stack = [from]
    while (stack.length > 0) {
      const cur = stack.pop()!
      if (cur === target) return true
      if (visited.has(cur)) continue
      visited.add(cur)
      const deps = adjMap.get(cur)
      if (deps) {
        for (const d of deps) {
          if (!(cur === excluded && d === target)) {
            stack.push(d)
          }
        }
      }
    }
    return false
  }

  // Build edges — only direct (non-redundant) cross-wave dependencies
  const edges: Array<{ from: NodePos; to: NodePos; color: string }> = []
  for (const node of nodes) {
    const deps = adjMap.get(node.agent.letter)
    if (!deps) continue
    for (const dep of deps) {
      // Skip if reachable through other deps (transitive/redundant edge)
      if (isReachableWithout(node.agent.letter, dep, node.agent.letter)) continue

      const source = nodeMap.get(dep)
      if (source) {
        const fill = getAgentFill(node.agent.letter)
        edges.push({ from: source, to: node, color: fill.border.replace('50', 'aa') })
      }
    }
  }

  const isLive = !!(executionState?.isLive) || (executionState?.agents?.size ?? 0) > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dependency Graph</CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="overflow-x-auto relative">
          <svg
            ref={svgRef}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block"
            onMouseLeave={handleMouseLeave}
          >
            {/* Wave column backgrounds */}
            {parsed.map((_wave, wi) => {
              const x = PAD_X + wi * WAVE_GAP - 16
              const colW = NODE_W + 32
              const color = WAVE_COLORS[wi % WAVE_COLORS.length]
              return (
                <rect
                  key={`bg-${wi}`}
                  x={x}
                  y={24}
                  width={colW}
                  height={height - 28}
                  rx={12}
                  fill={color}
                  opacity={0.08}
                />
              )
            })}

            {/* Wave labels */}
            {parsed.map((wave, wi) => (
              <text
                key={`label-${wave.number}`}
                x={PAD_X + wi * WAVE_GAP + NODE_W / 2}
                y={16}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize={11}
                fontWeight={600}
              >
                Wave {wave.number}
              </text>
            ))}

            {/* Edges */}
            {edges.map((edge, i) => {
              const x1 = edge.from.x + NODE_W
              const y1 = edge.from.y + NODE_H / 2
              const x2 = edge.to.x
              const y2 = edge.to.y + NODE_H / 2

              // Determine edge class based on source node exec status
              const sourceExec = getExecStatus(edge.from.agent.letter, edge.from.agent.wave)
              let edgeClassName: string | undefined
              let edgeOpacity: number | undefined

              if (isLive) {
                if (sourceExec?.status === 'complete') {
                  edgeClassName = 'exec-edge-active'
                } else {
                  edgeClassName = 'exec-edge-inactive'
                }
              } else {
                edgeOpacity = 0.6
              }

              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={edge.color}
                  strokeWidth={2}
                  opacity={edgeOpacity}
                  className={edgeClassName}
                />
              )
            })}

            {/* Arrow markers at edge endpoints */}
            {edges.map((edge, i) => {
              const x2 = edge.to.x
              const y2 = edge.to.y + NODE_H / 2

              // Mirror edge class onto arrow tip
              const sourceExec = getExecStatus(edge.from.agent.letter, edge.from.agent.wave)
              let arrowClassName: string | undefined
              let arrowOpacity: number | undefined

              if (isLive) {
                if (sourceExec?.status === 'complete') {
                  arrowClassName = 'exec-edge-active'
                } else {
                  arrowClassName = 'exec-edge-inactive'
                }
              } else {
                arrowOpacity = 0.6
              }

              return (
                <polygon
                  key={`arrow-${i}`}
                  points={`${x2},${y2} ${x2 - 6},${y2 - 3} ${x2 - 6},${y2 + 3}`}
                  fill={edge.color}
                  opacity={arrowOpacity}
                  className={arrowClassName}
                />
              )
            })}

            {/* Nodes */}
            {nodes.map(node => {
              const fill = getAgentFill(node.agent.letter)
              const label = getNodeLabel(node.agent.letter)
              const exec = getExecStatus(node.agent.letter, node.agent.wave)

              // Build node CSS class and style based on exec status
              let nodeClassName = 'cursor-pointer'
              let nodeStyle: React.CSSProperties | undefined
              let nodeFill = fill.bg
              let nodeStroke = fill.border

              if (exec) {
                if (exec.status === 'running') {
                  const color = getAgentColor(node.agent.letter)
                  nodeClassName += ' exec-node-running'
                  nodeStyle = { '--exec-pulse-color': color } as React.CSSProperties
                  nodeFill = `${color}40`
                } else if (exec.status === 'failed') {
                  nodeClassName += ' exec-node-failed'
                  nodeStroke = '#f85149'
                } else if (exec.status === 'complete') {
                  const color = getAgentColor(node.agent.letter)
                  nodeClassName += ' exec-node-complete'
                  nodeFill = `${color}60`
                }
              }

              const cx = node.x + NODE_W / 2
              const cy = node.y + NODE_H / 2

              return (
                <g
                  key={node.agent.letter}
                  className={nodeClassName}
                  style={nodeStyle}
                  onMouseEnter={(e) => {
                    const rect = (e.currentTarget as SVGGElement).getBoundingClientRect()
                    setTooltip({
                      x: rect.left + rect.width / 2,
                      y: rect.top,
                      agent: node.agent,
                    })
                  }}
                >
                  <rect
                    x={node.x}
                    y={node.y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={8}
                    fill={nodeFill}
                    stroke={nodeStroke}
                    strokeWidth={2}
                    strokeDasharray={fill.dashed ? '4 3' : undefined}
                  />
                  <text
                    x={cx}
                    y={cy + 1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={fill.text}
                    fontSize={label.length > 1 ? 12 : 16}
                    fontWeight={700}
                    fontFamily="ui-monospace, monospace"
                  >
                    {label}
                  </text>
                  {exec?.status === 'complete' && (
                    <g className="exec-check-overlay">
                      <circle
                        cx={node.x + NODE_W - 4}
                        cy={node.y + NODE_H - 4}
                        r={7}
                        fill="#22c55e"
                        opacity={0.9}
                      />
                      <path
                        d="M-3,0 L-1,2.5 L3,-2.5"
                        stroke="white"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                        transform={`translate(${node.x + NODE_W - 4}, ${node.y + NODE_H - 4})`}
                      />
                    </g>
                  )}
                </g>
              )
            })}
          </svg>

          {/* Tooltip - render outside scrollable container */}
        </div>
        {tooltip && createPortal(
          <div
            className="fixed z-[9999] pointer-events-none"
            style={{
              left: tooltip.x,
              top: tooltip.y - 8,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="bg-foreground text-background border border-foreground/20 rounded-lg shadow-xl p-3 max-w-[240px]">
              <div className="font-semibold text-sm mb-1">{tooltip.agent.letter === 'Scaffold' ? 'Scaffold Agent' : `Agent ${tooltip.agent.letter}`}</div>
              <div className="text-xs opacity-80">{tooltip.agent.description}</div>
              {tooltip.agent.dependencies.length > 0 && (
                <div className="text-xs opacity-70 mt-1">
                  depends on: {tooltip.agent.dependencies.map(d => `[${d}]`).join(' ')}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
      </CardContent>
    </Card>
  )
}
