import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { resetThemeCache, getAgentColor } from '../lib/entityColors'
import { getNodeFillColors } from '../lib/statusColors'
import { fetchProgramStatus } from '../programApi'
import { ProgramStatus, ImplTierStatus, ImplWaveInfo } from '../types/program'
import { layoutAgentWaves } from '../lib/graphLayout'

interface ProgramDependencyGraphProps {
  programSlug: string
  status?: ProgramStatus  // optional pre-fetched status to avoid double-fetch
  onSelectImpl?: (implSlug: string) => void
  waveProgress?: Record<string, string>
}

interface ImplNode {
  slug: string
  tier: number
  dependencies: string[]  // slugs of IMPLs this depends on
  status: string  // 'pending' | 'executing' | 'complete' | 'blocked' | 'reviewed'
  waves?: ImplWaveInfo[]
}

// Fixed-size fallback for IMPLs without wave data
const NODE_W = 140
const NODE_H = 74
const BASE_TIER_GAP = 180  // vertical gap between tier rows
const BASE_IMPL_GAP = 180  // horizontal gap between nodes in same row
const MIN_IMPL_GAP = 40    // minimum gap between IMPL containers
const PAD_X = 80
const PAD_Y = 50

// Nested layout constants — match DependencyGraphPanel proportions exactly
const AGENT_NODE_SIZE = 48    // same as DependencyGraphPanel NODE_W/NODE_H
const AGENT_GAP = 72          // same horizontal gap between agents
const WAVE_ROW_HEIGHT = 160   // vertical gap between wave rows (match DependencyGraphPanel)
const IMPL_PAD_X = 100        // left padding (room for wave labels)
const IMPL_PAD_Y = 60         // top padding (room for slug title + breathing room)
const IMPL_PAD_RIGHT = 100    // right padding — generous space after last node
const IMPL_PAD_BOTTOM = 50    // bottom padding
const IMPL_MIN_W = 300        // minimum IMPL width (ensures wave rows aren't cramped)
const IMPL_MIN_H = 120        // minimum IMPL height (no waves)
const WAVE_LABEL_X = 44       // center of wave label column inside IMPL
const WAVE_ROW_INNER_PAD = 24 // padding inside wave row background around nodes

// Wave row colors inside IMPL containers
const WAVE_COLORS = [
  '#3b82f6', // wave 1 -- blue
  '#ec4899', // wave 2 -- pink
  '#22c55e', // wave 3 -- green
  '#f59e0b', // wave 4 -- amber
  '#6366f1', // wave 5 -- indigo
  '#14b8a6', // wave 6 -- teal
]

// Tier column colors -- progressive spectrum for visual tier separation
const TIER_COLORS = [
  '#3b82f6', // tier 1 -- blue
  '#8b5cf6', // tier 2 -- violet
  '#ec4899', // tier 3 -- pink
  '#f59e0b', // tier 4 -- amber
  '#22c55e', // tier 5 -- green
  '#14b8a6', // tier 6 -- teal
  '#6366f1', // tier 7 -- indigo
]

interface NodePos {
  x: number
  y: number
  w: number
  h: number
  impl: ImplNode
}

function computeImplSize(waves?: ImplWaveInfo[]): { w: number; h: number } {
  if (!waves || waves.length === 0) return { w: IMPL_MIN_W, h: IMPL_MIN_H }
  const maxAgentsPerWave = Math.max(...waves.map(w => w.agents.length), 1)
  const agentAreaWidth = (maxAgentsPerWave - 1) * AGENT_GAP + AGENT_NODE_SIZE
  const w = Math.max(IMPL_MIN_W, IMPL_PAD_X + agentAreaWidth + IMPL_PAD_RIGHT)
  const h = IMPL_PAD_Y + (waves.length - 1) * WAVE_ROW_HEIGHT + AGENT_NODE_SIZE + IMPL_PAD_BOTTOM
  return { w, h }
}

/**
 * Build dependency graph from ProgramStatus.
 * Each IMPL in a tier can depend on IMPLs from prior tiers.
 */
function buildImplGraph(status: ProgramStatus): ImplNode[] {
  const nodes: ImplNode[] = []

  const tierMap = new Map<number, ImplTierStatus[]>()
  for (const tierStatus of status.tier_statuses) {
    tierMap.set(tierStatus.number, tierStatus.impl_statuses)
  }

  for (const tierStatus of status.tier_statuses) {
    for (const implStatus of tierStatus.impl_statuses) {
      const dependencies: string[] = []
      for (let priorTier = 1; priorTier < tierStatus.number; priorTier++) {
        const priorImpls = tierMap.get(priorTier) || []
        dependencies.push(...priorImpls.map(impl => impl.slug))
      }

      nodes.push({
        slug: implStatus.slug,
        tier: tierStatus.number,
        dependencies,
        status: implStatus.status,
        waves: implStatus.waves,
      })
    }
  }

  return nodes
}

function layoutNodes(
  nodes: ImplNode[],
  tierGap: number,
  _implGap: number,
): { nodes: NodePos[]; width: number; height: number } {
  const positions: NodePos[] = []

  // Pre-compute sizes for each node
  const sizeMap = new Map<string, { w: number; h: number }>()
  for (const node of nodes) {
    sizeMap.set(node.slug, computeImplSize(node.waves))
  }

  // Group by tier
  const tierGroups = new Map<number, ImplNode[]>()
  for (const node of nodes) {
    if (!tierGroups.has(node.tier)) {
      tierGroups.set(node.tier, [])
    }
    tierGroups.get(node.tier)!.push(node)
  }

  const tiers = Array.from(tierGroups.keys()).sort((a, b) => a - b)

  // Calculate max width needed across all tiers
  let maxRowWidth = 0
  for (const tier of tiers) {
    const impls = tierGroups.get(tier)!
    let rowWidth = 0
    for (const impl of impls) {
      const size = sizeMap.get(impl.slug)!
      rowWidth += size.w
    }
    rowWidth += (impls.length - 1) * 20 // gap between IMPLs in same tier
    maxRowWidth = Math.max(maxRowWidth, rowWidth)
  }

  const width = PAD_X * 2 + Math.max(maxRowWidth, NODE_W)

  // Layout each tier row
  let currentY = PAD_Y + 40
  const tierYPositions: number[] = []

  for (let ti = 0; ti < tiers.length; ti++) {
    const tier = tiers[ti]
    const impls = tierGroups.get(tier)!

    tierYPositions.push(currentY)

    // Calculate total width of this row
    let totalWidth = 0
    for (const impl of impls) {
      totalWidth += sizeMap.get(impl.slug)!.w
    }
    totalWidth += (impls.length - 1) * 20

    let startX = width / 2 - totalWidth / 2
    let maxH = 0

    for (const impl of impls) {
      const size = sizeMap.get(impl.slug)!
      positions.push({
        x: startX,
        y: currentY,
        w: size.w,
        h: size.h,
        impl,
      })
      startX += size.w + 20
      maxH = Math.max(maxH, size.h)
    }

    currentY += maxH + (ti < tiers.length - 1 ? tierGap - NODE_H : 0)
  }

  const lastTierMaxH = Math.max(
    ...Array.from(tierGroups.get(tiers[tiers.length - 1])!).map(
      impl => sizeMap.get(impl.slug)!.h
    )
  )
  const height = currentY - (tiers.length > 1 ? tierGap - NODE_H : 0) + lastTierMaxH + PAD_Y

  return { nodes: positions, width, height }
}

/**
 * Truncate text to fit within a given pixel width.
 */
function truncateSlug(slug: string, maxWidth: number): string {
  const charWidth = 7.2
  const maxChars = Math.floor(maxWidth / charWidth)
  if (slug.length <= maxChars) return slug
  return slug.substring(0, maxChars - 1) + '\u2026'
}


export default function ProgramDependencyGraph({
  programSlug,
  status,
  onSelectImpl,
  waveProgress,
}: ProgramDependencyGraphProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; impl: ImplNode } | null>(null)
  const [programStatus, setProgramStatus] = useState<ProgramStatus | undefined>(status)
  const [loading, setLoading] = useState(!status)
  const [error, setError] = useState<string>()
  const [, setThemeTick] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null)

  const handleMouseLeave = useCallback(() => setTooltip(null), [])

  // Responsive width via ResizeObserver
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    observer.observe(container)
    setContainerWidth(container.clientWidth)

    return () => observer.disconnect()
  }, [])

  // Sync programStatus state when parent's status prop updates (e.g. switching programs)
  useEffect(() => {
    if (status) {
      setProgramStatus(status)
      setLoading(false)
    }
  }, [status])

  // Fetch program status if not provided by parent
  useEffect(() => {
    if (status) return
    let cancelled = false

    fetchProgramStatus(programSlug)
      .then(s => {
        if (!cancelled) {
          setProgramStatus(s)
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message)
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [programSlug, status])

  // Re-render when dark mode or color theme changes
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

  // Compute dynamic gaps based on container width
  const { tierGap, implGap } = useMemo(() => {
    if (containerWidth <= 0) {
      return { tierGap: BASE_TIER_GAP, implGap: BASE_IMPL_GAP }
    }
    const tg = BASE_TIER_GAP
    const ig = Math.max(MIN_IMPL_GAP, Math.min(BASE_IMPL_GAP, containerWidth / 5))
    return { tierGap: tg, implGap: ig }
  }, [containerWidth])

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Program Dependency Graph</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Program Dependency Graph</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Error: {error}</p>
        </CardContent>
      </Card>
    )
  }

  if (!programStatus || programStatus.tier_statuses.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Program Dependency Graph</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No tiers to display</p>
        </CardContent>
      </Card>
    )
  }

  const implNodes = buildImplGraph(programStatus)
  if (implNodes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Program Dependency Graph</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No IMPLs to display</p>
        </CardContent>
      </Card>
    )
  }

  const { nodes, width, height } = layoutNodes(implNodes, tierGap, implGap)
  const nodeMap = new Map(nodes.map(n => [n.impl.slug, n]))

  // Use container width for SVG if available, otherwise computed width
  const svgWidth = containerWidth > 0 ? Math.max(width, containerWidth) : width

  // Build adjacency map for transitive reduction
  const adjMap = new Map<string, Set<string>>()
  for (const node of nodes) {
    const directDeps = new Set<string>()
    for (const dep of node.impl.dependencies) {
      const source = nodeMap.get(dep)
      if (source && source.impl.tier !== node.impl.tier) {
        directDeps.add(dep)
      }
    }
    adjMap.set(node.impl.slug, directDeps)
  }

  // Transitive reduction: drop edge A->C if A can reach C through other nodes
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

  // Build edges -- only direct (non-redundant) cross-tier dependencies
  const edges: Array<{ from: NodePos; to: NodePos; color: string }> = []
  for (const node of nodes) {
    const deps = adjMap.get(node.impl.slug)
    if (!deps) continue
    for (const dep of deps) {
      if (isReachableWithout(node.impl.slug, dep, node.impl.slug)) continue

      const source = nodeMap.get(dep)
      if (source) {
        const fill = getNodeFillColors(node.impl.status)
        edges.push({ from: source, to: node, color: fill.border })
      }
    }
  }

  // Group nodes by tier for labels
  const tierGroups = new Map<number, NodePos[]>()
  for (const node of nodes) {
    if (!tierGroups.has(node.impl.tier)) {
      tierGroups.set(node.impl.tier, [])
    }
    tierGroups.get(node.impl.tier)!.push(node)
  }
  const tiers = Array.from(tierGroups.keys()).sort((a, b) => a - b)

  /**
   * Render nested agent nodes inside an IMPL container.
   */
  function renderNestedAgents(node: NodePos) {
    if (!node.impl.waves || node.impl.waves.length === 0) return null

    // Build AgentNode[] for layout
    const agentWaves = node.impl.waves.map(w => ({
      number: w.number,
      agents: w.agents.map(a => ({
        id: a.id,
        wave: w.number,
        dependencies: a.dependencies || [],
      })),
    }))

    const layout = layoutAgentWaves(agentWaves, {
      nodeSize: AGENT_NODE_SIZE,
      waveGap: WAVE_ROW_HEIGHT,
      agentGap: AGENT_GAP,
      padX: IMPL_PAD_X,
      padY: IMPL_PAD_Y,
    })

    // Build a map from agent id to its status
    const agentStatusMap = new Map<string, string>()
    for (const wave of node.impl.waves) {
      for (const agent of wave.agents) {
        agentStatusMap.set(agent.id, agent.status)
      }
    }

    return (
      <g data-testid={`nested-agents-${node.impl.slug}`}>
        {/* Wave row backgrounds — colored bands like DependencyGraphPanel */}
        {node.impl.waves.map((_wave, wi) => {
          const y = node.y + IMPL_PAD_Y + wi * WAVE_ROW_HEIGHT - WAVE_ROW_INNER_PAD
          const rowH = AGENT_NODE_SIZE + WAVE_ROW_INNER_PAD * 2
          const color = WAVE_COLORS[wi % WAVE_COLORS.length]
          return (
            <rect
              key={`wave-bg-${wi}`}
              x={node.x + IMPL_PAD_X - 20}
              y={y}
              width={node.w - IMPL_PAD_X - IMPL_PAD_RIGHT + 80}
              height={rowH}
              rx={12}
              fill={color}
              opacity={0.08}
            />
          )
        })}

        {/* Wave labels — "WAVE" + number, left column */}
        {node.impl.waves.map((wave, wi) => {
          const cy = node.y + IMPL_PAD_Y + wi * WAVE_ROW_HEIGHT + AGENT_NODE_SIZE / 2
          const color = WAVE_COLORS[wi % WAVE_COLORS.length]
          return (
            <g key={`wave-label-${wave.number}`}>
              <text
                x={node.x + WAVE_LABEL_X}
                y={cy - 7}
                textAnchor="middle"
                dominantBaseline="central"
                fill={color}
                fontSize={9}
                fontWeight={600}
                letterSpacing={2}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textTransform: 'uppercase' }}
              >
                WAVE
              </text>
              <text
                x={node.x + WAVE_LABEL_X}
                y={cy + 10}
                textAnchor="middle"
                dominantBaseline="central"
                fill={color}
                fontSize={18}
                fontWeight={800}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              >
                {wave.number}
              </text>
            </g>
          )
        })}

        {/* Intra-IMPL dependency edges with particles */}
        {layout.edges.map((edge, ei) => {
          // edge.from = dependent (lower wave), edge.to = dependency (upper wave)
          // Draw line FROM dependency (top, wave 1) DOWN TO dependent (bottom, wave 2)
          const x1 = node.x + edge.to.x + AGENT_NODE_SIZE / 2    // dependency (upper)
          const y1 = node.y + edge.to.y + AGENT_NODE_SIZE         // bottom of dependency
          const x2 = node.x + edge.from.x + AGENT_NODE_SIZE / 2  // dependent (lower)
          const y2 = node.y + edge.from.y                         // top of dependent
          const midY = (y1 + y2) / 2
          const pathD = `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`

          const depStatus = agentStatusMap.get(edge.to.agent.id) || 'pending'
          const dependentStatus = agentStatusMap.get(edge.from.agent.id) || 'pending'
          const isActive = depStatus === 'complete' && dependentStatus === 'running'
          const isFailed = dependentStatus === 'failed'

          return (
            <g key={`intra-edge-${ei}`}>
              <path
                d={pathD}
                stroke="#6b728050"
                strokeWidth={2}
                fill="none"
              />
              {/* Arrow marker at target */}
              <polygon
                points={`${x2 - 4},${y2 - 6} ${x2 + 4},${y2 - 6} ${x2},${y2}`}
                fill="#6b728050"
              />
              {isActive && (<>
                <circle r="2.5" fill="#58a6ff" filter="url(#nested-particle-glow)" opacity="0.6">
                  <animateMotion dur="2.5s" begin="0s" repeatCount="indefinite" path={pathD} />
                </circle>
                <circle r="2.5" fill="#58a6ff" filter="url(#nested-particle-glow)" opacity="0.6">
                  <animateMotion dur="2.5s" begin="0.833s" repeatCount="indefinite" path={pathD} />
                </circle>
                <circle r="2.5" fill="#58a6ff" filter="url(#nested-particle-glow)" opacity="0.6">
                  <animateMotion dur="2.5s" begin="1.667s" repeatCount="indefinite" path={pathD} />
                </circle>
              </>)}
              {isFailed && (<>
                <circle r="2.5" fill="#f85149" filter="url(#nested-particle-glow-red)" opacity="0.5">
                  <animateMotion dur="4s" begin="0s" repeatCount="indefinite" path={pathD} />
                </circle>
                <circle r="2.5" fill="#f85149" filter="url(#nested-particle-glow-red)" opacity="0.5">
                  <animateMotion dur="4s" begin="1.333s" repeatCount="indefinite" path={pathD} />
                </circle>
                <circle r="2.5" fill="#f85149" filter="url(#nested-particle-glow-red)" opacity="0.5">
                  <animateMotion dur="4s" begin="2.667s" repeatCount="indefinite" path={pathD} />
                </circle>
              </>)}
            </g>
          )
        })}

        {/* Agent nodes — 48x48 rounded rects matching DependencyGraphPanel */}
        {layout.nodes.map(posAgent => {
          const agentStatus = agentStatusMap.get(posAgent.agent.id) || 'pending'
          const color = getAgentColor(posAgent.agent.id)
          const ax = node.x + posAgent.x
          const ay = node.y + posAgent.y
          const cx = ax + AGENT_NODE_SIZE / 2
          const cy = ay + AGENT_NODE_SIZE / 2

          // Match DependencyGraphPanel fill style
          const nodeFill = agentStatus === 'complete' ? `${color}30`
            : agentStatus === 'failed' ? '#f8514920'
            : agentStatus === 'running' ? `${color}25`
            : `${color}15`
          const nodeStroke = agentStatus === 'complete' ? `${color}70`
            : agentStatus === 'failed' ? '#f8514960'
            : agentStatus === 'running' ? `${color}60`
            : `${color}40`

          return (
            <g
              key={`agent-${posAgent.agent.id}`}
              className={agentStatus === 'running' ? 'exec-node-running' : undefined}
              style={agentStatus === 'running' ? {
                '--exec-pulse-color': color,
              } as React.CSSProperties : undefined}
            >
              <rect
                x={ax}
                y={ay}
                width={AGENT_NODE_SIZE}
                height={AGENT_NODE_SIZE}
                rx={8}
                fill={nodeFill}
                stroke={nodeStroke}
                strokeWidth={2}
              />
              {/* Agent letter */}
              <text
                x={cx}
                y={cy + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fill={color}
                fontSize={posAgent.agent.id.length > 1 ? 12 : 16}
                fontWeight={700}
                fontFamily="ui-monospace, monospace"
              >
                {posAgent.agent.id}
              </text>
              {/* Complete checkmark — bottom-right green circle */}
              {agentStatus === 'complete' && (
                <g className="exec-check-overlay">
                  <circle
                    cx={ax + AGENT_NODE_SIZE - 4}
                    cy={ay + AGENT_NODE_SIZE - 4}
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
                    transform={`translate(${ax + AGENT_NODE_SIZE - 4}, ${ay + AGENT_NODE_SIZE - 4})`}
                  />
                </g>
              )}
              {/* Failed — red dashed ring */}
              {agentStatus === 'failed' && (
                <rect
                  x={ax - 3}
                  y={ay - 3}
                  width={AGENT_NODE_SIZE + 6}
                  height={AGENT_NODE_SIZE + 6}
                  rx={10}
                  fill="none"
                  stroke="#f85149"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
              )}
            </g>
          )
        })}
      </g>
    )
  }

  /**
   * Build tooltip content with agent summary for IMPLs with wave data.
   */
  function renderTooltipContent(impl: ImplNode) {
    const waveSummary = impl.waves && impl.waves.length > 0
      ? impl.waves.map(w => `W${w.number}: ${w.agents.map(a => a.id).join(', ')}`).join(' | ')
      : null
    const agentCount = impl.waves
      ? impl.waves.reduce((sum, w) => sum + w.agents.length, 0)
      : 0

    return (
      <div className="bg-foreground text-background border border-foreground/20 rounded-lg shadow-xl p-3 max-w-[280px]">
        <div className="font-semibold text-sm mb-1">{impl.slug}</div>
        <div className="text-xs opacity-80">Tier {impl.tier}</div>
        <div className="text-xs opacity-80 mt-1">
          Status: <span className="font-medium">{impl.status}</span>
        </div>
        {waveProgress?.[impl.slug] && (
          <div className="text-xs opacity-80 mt-1">
            Wave: <span className="font-medium">{waveProgress[impl.slug]}</span>
          </div>
        )}
        {impl.waves && impl.waves.length > 0 && (
          <>
            <div className="text-xs opacity-80 mt-1">
              Agents: {agentCount} across {impl.waves.length} wave{impl.waves.length > 1 ? 's' : ''}
            </div>
            <div className="text-xs opacity-70 mt-1 font-mono">
              {waveSummary}
            </div>
          </>
        )}
        {impl.dependencies.length > 0 && (
          <div className="text-xs opacity-70 mt-1">
            Dependencies: {impl.dependencies.length}
          </div>
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Program Dependency Graph</CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="overflow-auto relative w-full">
          <svg
            ref={svgRef}
            width="100%"
            height={height}
            viewBox={`0 0 ${svgWidth} ${height}`}
            className="block"
            style={{ minWidth: width }}
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              <filter id="impl-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="nested-particle-glow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="nested-particle-glow-red" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Tier row backgrounds */}
            {tiers.map((tier, ti) => {
              const tierNodes = tierGroups.get(tier)!
              const minY = Math.min(...tierNodes.map(n => n.y))
              const maxH = Math.max(...tierNodes.map(n => n.h))
              const y = minY - 30
              const rowH = maxH + 60
              const color = TIER_COLORS[ti % TIER_COLORS.length]
              return (
                <rect
                  key={`bg-${tier}`}
                  x={PAD_X - 12}
                  y={y}
                  width={width - PAD_X * 2 + 24}
                  height={rowH}
                  rx={12}
                  fill={color}
                  opacity={0.08}
                />
              )
            })}

            {/* Tier labels -- left of each row */}
            {tiers.map((tier, ti) => {
              const tierNodes = tierGroups.get(tier)!
              const minY = Math.min(...tierNodes.map(n => n.y))
              const maxH = Math.max(...tierNodes.map(n => n.h))
              const y = minY + maxH / 2
              const color = TIER_COLORS[ti % TIER_COLORS.length]
              return (
                <g key={`label-${tier}`}>
                  <text
                    x={12}
                    y={y - 7}
                    textAnchor="start"
                    dominantBaseline="central"
                    fill={color}
                    fontSize={9}
                    fontWeight={600}
                    letterSpacing={2}
                    style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textTransform: 'uppercase' }}
                  >
                    TIER
                  </text>
                  <text
                    x={12}
                    y={y + 10}
                    textAnchor="start"
                    dominantBaseline="central"
                    fill={color}
                    fontSize={18}
                    fontWeight={800}
                    style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                  >
                    {tier}
                  </text>
                </g>
              )
            })}

            {/* Inter-tier edges */}
            {edges.map((edge, i) => {
              const x1 = edge.from.x + edge.from.w / 2
              const y1 = edge.from.y + edge.from.h
              const x2 = edge.to.x + edge.to.w / 2
              const y2 = edge.to.y
              const midY = (y1 + y2) / 2

              const pathD = `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`

              return (
                <g key={`edge-group-${i}`}>
                  <path
                    d={pathD}
                    stroke={edge.color}
                    strokeWidth={2}
                    fill="none"
                    opacity={0.5}
                  />
                  <polygon
                    points={`${x2},${y2} ${x2 - 5},${y2 - 10} ${x2 + 5},${y2 - 10}`}
                    fill={edge.color}
                    opacity={0.5}
                  />
                </g>
              )
            })}

            {/* IMPL Container Nodes */}
            {nodes.map(node => {
              const fill = getNodeFillColors(node.impl.status)
              const cx = node.x + node.w / 2
              const isHovered = hoveredSlug === node.impl.slug
              const isClickable = !!onSelectImpl
              const isComplete = node.impl.status.toLowerCase().includes('complete')
              const hasWaves = node.impl.waves && node.impl.waves.length > 0

              const displaySlug = truncateSlug(node.impl.slug, node.w - 16)

              // Get wave progress text from prop or node data
              const progress = waveProgress?.[node.impl.slug]

              const statusLabel = node.impl.status

              return (
                <g
                  key={node.impl.slug}
                  style={{
                    cursor: isClickable ? 'pointer' : 'default',
                    transition: 'transform 0.15s ease',
                  }}
                  transform={isHovered && isClickable ? `translate(${cx}, ${node.y + node.h / 2}) scale(1.05) translate(${-cx}, ${-(node.y + node.h / 2)})` : undefined}
                  onMouseEnter={(e) => {
                    setHoveredSlug(node.impl.slug)
                    const rect = (e.currentTarget as SVGGElement).getBoundingClientRect()
                    setTooltip({
                      x: rect.left + rect.width / 2,
                      y: rect.top,
                      impl: node.impl,
                    })
                  }}
                  onMouseLeave={() => {
                    setHoveredSlug(null)
                  }}
                  onClick={() => {
                    if (onSelectImpl) {
                      onSelectImpl(node.impl.slug)
                    }
                  }}
                >
                  {/* IMPL container rect */}
                  <rect
                    x={node.x}
                    y={node.y}
                    width={node.w}
                    height={node.h}
                    rx={8}
                    fill={fill.bg}
                    stroke={isComplete ? '#22c55e80' : isHovered && isClickable ? fill.text : fill.border}
                    strokeWidth={isComplete ? 2.5 : isHovered && isClickable ? 2.5 : 2}
                  />
                  {/* Slug text */}
                  <text
                    x={cx}
                    y={node.y + (hasWaves ? 14 : 18)}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={isComplete ? '#22c55e' : fill.text}
                    fontSize={11}
                    fontWeight={700}
                    fontFamily="ui-monospace, monospace"
                  >
                    {displaySlug}
                  </text>
                  {/* Completion checkmark badge — bottom-right corner */}
                  {isComplete && (
                    <g>
                      <circle
                        cx={node.x + node.w - 14}
                        cy={node.y + node.h - 14}
                        r={10}
                        fill="#22c55e"
                        opacity={0.9}
                      />
                      <path
                        d="M-5,0 L-1.5,4 L5,-4"
                        stroke="white"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                        transform={`translate(${node.x + node.w - 14}, ${node.y + node.h - 14})`}
                      />
                    </g>
                  )}

                  {/* For nodes WITHOUT wave data: render old-style status badge + progress */}
                  {!hasWaves && (
                    <>
                      {/* Status badge */}
                      <g>
                        <rect
                          x={cx - 28}
                          y={node.y + 30}
                          width={56}
                          height={14}
                          rx={4}
                          fill={fill.border}
                          opacity={0.5}
                        />
                        <text
                          x={cx}
                          y={node.y + 37}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill={fill.text}
                          fontSize={8}
                          fontWeight={600}
                          fontFamily="ui-monospace, monospace"
                          style={{ textTransform: 'uppercase' }}
                        >
                          {statusLabel}
                        </text>
                      </g>
                      {/* Wave progress bar */}
                      {progress && (() => {
                        const match = progress.match(/(\d+)\/(\d+)/)
                        const current = match ? parseInt(match[1]) : 0
                        const total = match ? parseInt(match[2]) : 0
                        if (total <= 0) return null
                        const barX = node.x + 8
                        const barY = node.y + node.h - 14
                        const barW = node.w - 16
                        const segW = (barW - (total - 1) * 2) / total
                        return (
                          <g>
                            {Array.from({ length: total }, (_, i) => (
                              <rect
                                key={i}
                                x={barX + i * (segW + 2)}
                                y={barY}
                                width={segW}
                                height={6}
                                rx={2}
                                fill={i < current ? fill.text : fill.border}
                                opacity={i < current ? 0.8 : 0.3}
                              />
                            ))}
                            <text
                              x={cx}
                              y={barY + 3}
                              textAnchor="middle"
                              dominantBaseline="central"
                              fill={fill.text}
                              fontSize={5}
                              fontWeight={700}
                              fontFamily="ui-monospace, monospace"
                              opacity={0.6}
                            >
                              {progress}
                            </text>
                          </g>
                        )
                      })()}
                    </>
                  )}

                  {/* Nested agent nodes for IMPLs with wave data */}
                  {hasWaves && renderNestedAgents(node)}
                </g>
              )
            })}
          </svg>
        </div>

        {/* Tooltip */}
        {tooltip && createPortal(
          <div
            className="fixed z-[9999] pointer-events-none"
            style={{
              left: tooltip.x,
              top: tooltip.y - 8,
              transform: 'translate(-50%, -100%)',
            }}
          >
            {renderTooltipContent(tooltip.impl)}
          </div>,
          document.body,
        )}
      </CardContent>
    </Card>
  )
}
