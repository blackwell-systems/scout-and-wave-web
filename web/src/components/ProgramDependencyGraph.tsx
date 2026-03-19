import { useRef, useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { resetThemeCache } from '../lib/agentColors'
import { fetchProgramStatus } from '../programApi'
import { ProgramStatus, ImplTierStatus } from '../types/program'

interface ProgramDependencyGraphProps {
  programSlug: string
  status?: ProgramStatus  // optional pre-fetched status to avoid double-fetch
}

interface ImplNode {
  slug: string
  tier: number
  dependencies: string[]  // slugs of IMPLs this depends on
  status: string  // 'pending' | 'executing' | 'complete' | 'blocked'
}

const NODE_W = 80
const NODE_H = 56
const TIER_GAP = 180
const IMPL_GAP = 80
const PAD_X = 120
const PAD_Y = 50
const LABEL_X = 60 // center of the left label column

// Tier column colors — progressive spectrum for visual tier separation
const TIER_COLORS = [
  '#3b82f6', // tier 1 — blue
  '#8b5cf6', // tier 2 — violet
  '#ec4899', // tier 3 — pink
  '#f59e0b', // tier 4 — amber
  '#22c55e', // tier 5 — green
  '#14b8a6', // tier 6 — teal
  '#6366f1', // tier 7 — indigo
]

interface NodePos {
  x: number
  y: number
  impl: ImplNode
}

/**
 * Build dependency graph from ProgramStatus.
 * Each IMPL in a tier can depend on IMPLs from prior tiers.
 * Dependencies are inferred from the IMPL manifest depends_on relationships
 * (implicit in tier structure: higher tiers depend on lower tiers).
 */
function buildImplGraph(status: ProgramStatus): ImplNode[] {
  const nodes: ImplNode[] = []

  // Build a map of all IMPLs by tier
  const tierMap = new Map<number, ImplTierStatus[]>()
  for (const tierStatus of status.tier_statuses) {
    tierMap.set(tierStatus.number, tierStatus.impl_statuses)
  }

  // For each tier, extract IMPLs and build dependency edges
  for (const tierStatus of status.tier_statuses) {
    for (const implStatus of tierStatus.impl_statuses) {
      // Dependencies: all IMPLs from prior tiers (simplified assumption)
      // In a real system, this would come from the IMPL manifest's depends_on field
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
      })
    }
  }

  return nodes
}

function layoutNodes(nodes: ImplNode[]): { nodes: NodePos[]; width: number; height: number } {
  const positions: NodePos[] = []

  // Group by tier
  const tierGroups = new Map<number, ImplNode[]>()
  for (const node of nodes) {
    if (!tierGroups.has(node.tier)) {
      tierGroups.set(node.tier, [])
    }
    tierGroups.get(node.tier)!.push(node)
  }

  const tiers = Array.from(tierGroups.keys()).sort((a, b) => a - b)
  const maxImpls = Math.max(...Array.from(tierGroups.values()).map(g => g.length))

  const bandLeft = PAD_X - 12
  const implAreaWidth = (maxImpls - 1) * IMPL_GAP + NODE_W
  const width = bandLeft + implAreaWidth + PAD_X
  const bandRight = width - 4
  const bandCenter = (bandLeft + bandRight) / 2

  for (let ti = 0; ti < tiers.length; ti++) {
    const tier = tiers[ti]
    const impls = tierGroups.get(tier)!
    const x = PAD_X + ti * TIER_GAP

    const totalHeight = (impls.length - 1) * IMPL_GAP + NODE_H
    const startY = bandCenter - totalHeight / 2

    for (let ii = 0; ii < impls.length; ii++) {
      positions.push({
        x,
        y: startY + ii * IMPL_GAP,
        impl: impls[ii],
      })
    }
  }

  const height = PAD_Y * 2 + implAreaWidth // use same vertical space calculation

  return { nodes: positions, width, height }
}

/**
 * Get node fill colors based on IMPL status.
 */
function getNodeFill(status: string): { bg: string; border: string; text: string } {
  switch (status) {
    case 'complete':
      return { bg: '#22c55e40', border: '#22c55e80', text: '#22c55e' }
    case 'executing':
      return { bg: '#3b82f640', border: '#3b82f680', text: '#3b82f6' }
    case 'blocked':
      return { bg: '#ef444440', border: '#ef444480', text: '#ef4444' }
    default: // pending
      return { bg: '#6b728020', border: '#6b728060', text: '#6b7280' }
  }
}

export default function ProgramDependencyGraph({ programSlug, status }: ProgramDependencyGraphProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; impl: ImplNode } | null>(null)
  const [programStatus, setProgramStatus] = useState<ProgramStatus | undefined>(status)
  const [loading, setLoading] = useState(!status)
  const [error, setError] = useState<string>()
  const [, setThemeTick] = useState(0)

  const handleMouseLeave = useCallback(() => setTooltip(null), [])

  // Fetch program status if not provided
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

  const { nodes, width, height } = layoutNodes(implNodes)
  const nodeMap = new Map(nodes.map(n => [n.impl.slug, n]))

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

  // Build edges — only direct (non-redundant) cross-tier dependencies
  const edges: Array<{ from: NodePos; to: NodePos; color: string }> = []
  for (const node of nodes) {
    const deps = adjMap.get(node.impl.slug)
    if (!deps) continue
    for (const dep of deps) {
      // Skip if reachable through other deps (transitive/redundant edge)
      if (isReachableWithout(node.impl.slug, dep, node.impl.slug)) continue

      const source = nodeMap.get(dep)
      if (source) {
        const fill = getNodeFill(node.impl.status)
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Program Dependency Graph</CardTitle>
      </CardHeader>
      <CardContent>
        <div ref={containerRef} className="overflow-auto relative">
          <svg
            ref={svgRef}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block"
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
            </defs>

            {/* Tier column backgrounds */}
            {tiers.map((tier, ti) => {
              const x = PAD_X + ti * TIER_GAP - 16
              const colW = NODE_W + 32
              const color = TIER_COLORS[ti % TIER_COLORS.length]
              return (
                <rect
                  key={`bg-${tier}`}
                  x={x}
                  y={PAD_Y - 12}
                  width={colW}
                  height={height - PAD_Y * 2 + 24}
                  rx={12}
                  fill={color}
                  opacity={0.08}
                />
              )
            })}

            {/* Tier labels — left side */}
            {tiers.map((tier, ti) => {
              const x = PAD_X + ti * TIER_GAP + NODE_W / 2
              const color = TIER_COLORS[ti % TIER_COLORS.length]
              return (
                <g key={`label-${tier}`}>
                  <text
                    x={x}
                    y={LABEL_X - 7}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={color}
                    fontSize={10}
                    fontWeight={600}
                    letterSpacing={2.5}
                    style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textTransform: 'uppercase' }}
                  >
                    TIER
                  </text>
                  <text
                    x={x}
                    y={LABEL_X + 10}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={color}
                    fontSize={20}
                    fontWeight={800}
                    style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                  >
                    {tier}
                  </text>
                </g>
              )
            })}

            {/* Edges */}
            {edges.map((edge, i) => {
              const x1 = edge.from.x + NODE_W
              const y1 = edge.from.y + NODE_H / 2
              const x2 = edge.to.x
              const y2 = edge.to.y + NODE_H / 2
              const midX = (x1 + x2) / 2

              // Cubic bezier for smooth curves
              const pathD = `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`

              return (
                <g key={`edge-group-${i}`}>
                  <path
                    d={pathD}
                    stroke={edge.color}
                    strokeWidth={2}
                    fill="none"
                    opacity={0.5}
                  />
                  {/* Arrow marker */}
                  <polygon
                    points={`${x2},${y2} ${x2 - 10},${y2 - 5} ${x2 - 10},${y2 + 5}`}
                    fill={edge.color}
                    opacity={0.5}
                  />
                </g>
              )
            })}

            {/* Nodes */}
            {nodes.map(node => {
              const fill = getNodeFill(node.impl.status)
              const cx = node.x + NODE_W / 2
              const cy = node.y + NODE_H / 2

              // Abbreviated IMPL slug for display (e.g., "user-auth" -> "UA")
              const slugParts = node.impl.slug.split('-')
              const label = slugParts.length > 1
                ? slugParts.map(p => p[0].toUpperCase()).join('')
                : node.impl.slug.substring(0, 3).toUpperCase()

              return (
                <g
                  key={node.impl.slug}
                  className="cursor-pointer"
                  onMouseEnter={(e) => {
                    const rect = (e.currentTarget as SVGGElement).getBoundingClientRect()
                    setTooltip({
                      x: rect.left + rect.width / 2,
                      y: rect.top,
                      impl: node.impl,
                    })
                  }}
                >
                  <rect
                    x={node.x}
                    y={node.y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={8}
                    fill={fill.bg}
                    stroke={fill.border}
                    strokeWidth={2}
                  />
                  <text
                    x={cx}
                    y={cy + 1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={fill.text}
                    fontSize={12}
                    fontWeight={700}
                    fontFamily="ui-monospace, monospace"
                  >
                    {label}
                  </text>
                  {/* Status indicator badge */}
                  {node.impl.status === 'complete' && (
                    <g>
                      <circle
                        cx={node.x + NODE_W - 6}
                        cy={node.y + NODE_H - 6}
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
                        transform={`translate(${node.x + NODE_W - 6}, ${node.y + NODE_H - 6})`}
                      />
                    </g>
                  )}
                  {node.impl.status === 'executing' && (
                    <circle
                      cx={node.x + NODE_W - 6}
                      cy={node.y + NODE_H - 6}
                      r={5}
                      fill="#3b82f6"
                      opacity={0.8}
                    >
                      <animate
                        attributeName="opacity"
                        values="0.4;1;0.4"
                        dur="1.5s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}
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
            <div className="bg-foreground text-background border border-foreground/20 rounded-lg shadow-xl p-3 max-w-[280px]">
              <div className="font-semibold text-sm mb-1">{tooltip.impl.slug}</div>
              <div className="text-xs opacity-80">Tier {tooltip.impl.tier}</div>
              <div className="text-xs opacity-80 mt-1">
                Status: <span className="font-medium">{tooltip.impl.status}</span>
              </div>
              {tooltip.impl.dependencies.length > 0 && (
                <div className="text-xs opacity-70 mt-1">
                  Dependencies: {tooltip.impl.dependencies.length}
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
