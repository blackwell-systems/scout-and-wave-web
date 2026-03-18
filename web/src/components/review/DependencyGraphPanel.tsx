import { useRef, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { getAgentColor, resetThemeCache } from '../../lib/agentColors'
import { ExecutionSyncState, AgentExecStatus } from '../../hooks/useExecutionSync'
import { WaveInfo, FileOwnershipEntry } from '../../types'

interface DependencyGraphPanelProps {
  dependencyGraphText?: string
  impl?: { waves: WaveInfo[]; file_ownership: FileOwnershipEntry[] }
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

function buildWavesFromImpl(impl: { waves: WaveInfo[]; file_ownership: FileOwnershipEntry[] }): ParsedWave[] {
  return impl.waves.map(wave => ({
    number: wave.number,
    agents: wave.agents.map(agentId => {
      // Find files owned by this agent in this wave
      const ownedFiles = impl.file_ownership
        .filter(f => f.agent === agentId && f.wave === wave.number)
        .map(f => f.file)

      // Dependencies: agents from prior waves that this wave depends on
      const deps: string[] = []
      if (wave.dependencies && wave.dependencies.length > 0) {
        for (const depWaveNum of wave.dependencies) {
          const depWave = impl.waves.find(w => w.number === depWaveNum)
          if (depWave) {
            deps.push(...depWave.agents)
          }
        }
      }

      return {
        letter: agentId,
        description: ownedFiles.length > 0 ? ownedFiles.join(', ') : `Agent ${agentId}`,
        dependencies: deps,
        wave: wave.number,
      }
    }),
  }))
}

const NODE_W = 48
const NODE_H = 48
const WAVE_GAP = 160
const AGENT_GAP = 72
const PAD_X = 100
const PAD_Y = 40
const LABEL_X = 44 // center of the left label column (outside the row bands)

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

  // The row band area runs from bandLeft to bandRight; center agents within it.
  const bandLeft = PAD_X - 12
  const agentAreaWidth = (maxAgents - 1) * AGENT_GAP + NODE_W
  const width = bandLeft + agentAreaWidth + PAD_X
  const bandRight = width - 4
  const bandCenter = (bandLeft + bandRight) / 2

  for (let wi = 0; wi < waves.length; wi++) {
    const wave = waves[wi]
    const y = PAD_Y + wi * WAVE_GAP
    const totalWidth = (wave.agents.length - 1) * AGENT_GAP + NODE_W
    const startX = bandCenter - totalWidth / 2

    for (let ai = 0; ai < wave.agents.length; ai++) {
      nodes.push({
        x: startX + ai * AGENT_GAP,
        y,
        agent: wave.agents[ai],
      })
    }
  }

  const height = PAD_Y * 2 + (waves.length - 1) * WAVE_GAP + NODE_H

  return { nodes, width, height }
}

export default function DependencyGraphPanel({ dependencyGraphText, impl, executionState }: DependencyGraphPanelProps): JSX.Element {
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
    if (!executionState) return undefined
    // Scaffold node uses separate scaffoldStatus field — check before agents map
    // guard because scaffold runs while agents map is still empty
    if (letter === 'Scaffold' && wave === 0) {
      const s = executionState.scaffoldStatus
      if (s === 'idle') return undefined
      return { status: s === 'complete' ? 'complete' : s === 'failed' ? 'failed' : 'running' } as AgentExecStatus
    }
    if (executionState.agents.size === 0) return undefined
    return executionState.agents.get(`${wave}:${letter}`)
  }

  const hasText = dependencyGraphText && dependencyGraphText.trim() !== ''
  const hasImplWaves = impl?.waves && impl.waves.length > 0

  if (!hasText && !hasImplWaves) {
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

  const parsed = hasText
    ? parseDependencyGraph(dependencyGraphText!)
    : buildWavesFromImpl(impl!)

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

  const isLive = !!(executionState?.isLive)

  // Classify each edge for animation purposes
  type EdgeState = 'static' | 'active' | 'waiting' | 'failed'
  function getEdgeState(edge: { from: NodePos; to: NodePos }): EdgeState {
    if (!isLive) return 'static'
    const sourceExec = getExecStatus(edge.from.agent.letter, edge.from.agent.wave)
    const targetExec = getExecStatus(edge.to.agent.letter, edge.to.agent.wave)
    if (sourceExec?.status === 'failed') return 'failed'
    if (sourceExec?.status === 'complete' && targetExec?.status === 'running') return 'active'
    if (sourceExec?.status === 'complete') return 'active'
    if (sourceExec?.status === 'running') return 'waiting'
    return 'waiting'
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dependency Graph</CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="overflow-y-auto relative">
          <svg
            ref={svgRef}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block"
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              <filter id="particle-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="particle-glow-red" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Wave row backgrounds */}
            {parsed.map((_wave, wi) => {
              const y = PAD_Y + wi * WAVE_GAP - 16
              const rowH = NODE_H + 32
              const color = WAVE_COLORS[wi % WAVE_COLORS.length]
              return (
                <rect
                  key={`bg-${wi}`}
                  x={PAD_X - 12}
                  y={y}
                  width={width - PAD_X + 8}
                  height={rowH + 4}
                  rx={12}
                  fill={color}
                  opacity={0.08}
                />
              )
            })}

            {/* Wave labels — spelled out, left of row bands */}
            {parsed.map((wave, wi) => {
              const cy = PAD_Y + wi * WAVE_GAP + NODE_H / 2
              const color = WAVE_COLORS[wi % WAVE_COLORS.length]
              return (
                <g key={`label-${wave.number}`}>
                  <text
                    x={LABEL_X}
                    y={cy - 7}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={color}
                    fontSize={10}
                    fontWeight={600}
                    letterSpacing={2.5}
                    style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textTransform: 'uppercase' }}
                  >
                    WAVE
                  </text>
                  <text
                    x={LABEL_X}
                    y={cy + 10}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={color}
                    fontSize={20}
                    fontWeight={800}
                    style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                  >
                    {wave.number}
                  </text>
                </g>
              )
            })}

            {/* Edges + particles */}
            {edges.map((edge, i) => {
              const x1 = edge.from.x + NODE_W / 2
              const y1 = edge.from.y + NODE_H
              const x2 = edge.to.x + NODE_W / 2
              const y2 = edge.to.y
              const edgeState = getEdgeState(edge)

              // Build a cubic bezier path for smooth curves + animateMotion
              const midY = (y1 + y2) / 2
              const pathD = `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`

              let edgeClassName: string | undefined
              let edgeOpacity: number | undefined
              let strokeW = 2

              if (isLive) {
                if (edgeState === 'active') {
                  edgeClassName = 'exec-edge-active'
                  strokeW = 2.5
                } else if (edgeState === 'failed') {
                  edgeClassName = 'exec-edge-active'
                } else {
                  edgeClassName = 'exec-edge-inactive'
                }
              } else {
                edgeOpacity = 0.6
              }

              const edgeColor = edgeState === 'failed' ? '#f85149' : edge.color

              return (
                <g key={`edge-group-${i}`}>
                  {/* Edge line — curved bezier matching particle path */}
                  <path
                    d={pathD}
                    stroke={edgeColor}
                    strokeWidth={strokeW}
                    fill="none"
                    opacity={edgeOpacity}
                    className={edgeClassName}
                  />

                  {/* Arrow marker */}
                  <polygon
                    points={`${x2},${y2} ${x2 - 5},${y2 - 10} ${x2 + 5},${y2 - 10}`}
                    fill={edgeColor}
                    opacity={edgeOpacity}
                    className={edgeClassName}
                  />

                  {/* Flowing particle — single subtle dot on active edges */}
                  {edgeState === 'active' && (
                    <circle r="2.5" fill={edge.color} filter="url(#particle-glow)" opacity="0.6">
                      <animateMotion dur="2.5s" repeatCount="indefinite" path={pathD} />
                    </circle>
                  )}
                  {edgeState === 'failed' && (
                    <circle r="2" fill="#f85149" filter="url(#particle-glow-red)" opacity="0.5">
                      <animateMotion dur="4s" repeatCount="indefinite" path={pathD} />
                    </circle>
                  )}
                </g>
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
                        d="M-4,0 L-1,3 L4,-3"
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
