import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { resetThemeCache } from '../lib/entityColors'
import { fetchProgramStatus } from '../programApi'
import { ProgramStatus, ImplTierStatus } from '../types/program'

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
}

const NODE_W = 140
const NODE_H = 74
const BASE_TIER_GAP = 140  // vertical gap between tier rows
const BASE_IMPL_GAP = 160  // horizontal gap between nodes in same row (must > NODE_W)
// MIN_TIER_GAP removed — tierGap is fixed in vertical layout
const MIN_IMPL_GAP = 155
const PAD_X = 60
const PAD_Y = 30
// LABEL_X removed — tier labels now positioned inline with rows

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

function layoutNodes(
  nodes: ImplNode[],
  tierGap: number,
  implGap: number,
): { nodes: NodePos[]; width: number; height: number } {
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

  // Vertical layout: tiers as rows (top-to-bottom), IMPLs spread horizontally
  const implAreaWidth = (maxImpls - 1) * implGap + NODE_W
  const width = PAD_X * 2 + implAreaWidth

  for (let ti = 0; ti < tiers.length; ti++) {
    const tier = tiers[ti]
    const impls = tierGroups.get(tier)!
    const y = PAD_Y + 40 + ti * tierGap // 40px offset for tier label above

    const totalWidth = (impls.length - 1) * implGap + NODE_W
    const startX = width / 2 - totalWidth / 2

    for (let ii = 0; ii < impls.length; ii++) {
      positions.push({
        x: startX + ii * implGap,
        y,
        impl: impls[ii],
      })
    }
  }

  const height = PAD_Y * 2 + 40 + (tiers.length - 1) * tierGap + NODE_H

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
    case 'reviewed':
      return { bg: '#eab30840', border: '#eab30880', text: '#eab308' }
    default: // pending
      return { bg: '#6b728020', border: '#6b728060', text: '#6b7280' }
  }
}

/**
 * Truncate text to fit within a given pixel width.
 * Approximate: monospace chars ~7.2px at fontSize 11.
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
    // Set initial width
    setContainerWidth(container.clientWidth)

    return () => observer.disconnect()
  }, [])

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

  // Compute dynamic gaps based on container width
  const { tierGap, implGap } = useMemo(() => {
    if (containerWidth <= 0) {
      return { tierGap: BASE_TIER_GAP, implGap: BASE_IMPL_GAP }
    }
    // Vertical layout: tierGap is fixed (vertical), implGap scales with container width
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
            </defs>

            {/* Tier row backgrounds */}
            {tiers.map((tier, ti) => {
              const y = PAD_Y + 40 + ti * tierGap - 16
              const rowH = NODE_H + 32
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

            {/* Tier labels — left of each row */}
            {tiers.map((tier, ti) => {
              const y = PAD_Y + 40 + ti * tierGap + NODE_H / 2
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

            {/* Edges */}
            {edges.map((edge, i) => {
              const x1 = edge.from.x + NODE_W / 2
              const y1 = edge.from.y + NODE_H
              const x2 = edge.to.x + NODE_W / 2
              const y2 = edge.to.y
              const midY = (y1 + y2) / 2

              // Cubic bezier for smooth vertical curves
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
                  {/* Arrow marker */}
                  <polygon
                    points={`${x2},${y2} ${x2 - 5},${y2 - 10} ${x2 + 5},${y2 - 10}`}
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
              const isHovered = hoveredSlug === node.impl.slug
              const isClickable = !!onSelectImpl

              // Truncate slug to fit within node
              const displaySlug = truncateSlug(node.impl.slug, NODE_W - 16)

              // Get wave progress text from prop or node data
              const progress = waveProgress?.[node.impl.slug]

              // Status label for badge
              const statusLabel = node.impl.status

              return (
                <g
                  key={node.impl.slug}
                  style={{
                    cursor: isClickable ? 'pointer' : 'default',
                    transition: 'transform 0.15s ease',
                  }}
                  transform={isHovered && isClickable ? `translate(${cx}, ${node.y + NODE_H / 2}) scale(1.05) translate(${-cx}, ${-(node.y + NODE_H / 2)})` : undefined}
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
                  <rect
                    x={node.x}
                    y={node.y}
                    width={NODE_W}
                    height={NODE_H}
                    rx={8}
                    fill={fill.bg}
                    stroke={isHovered && isClickable ? fill.text : fill.border}
                    strokeWidth={isHovered && isClickable ? 2.5 : 2}
                  />
                  {/* Slug text */}
                  <text
                    x={cx}
                    y={node.y + 18}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={fill.text}
                    fontSize={11}
                    fontWeight={700}
                    fontFamily="ui-monospace, monospace"
                  >
                    {displaySlug}
                  </text>
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
                    const barY = node.y + NODE_H - 14
                    const barW = NODE_W - 16
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
                  {/* Legacy wave progress text fallback */}
                  {false && (node.impl.status === 'executing') && progress && (
                    <text
                      x={cx}
                      y={node.y + 54}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill={fill.text}
                      fontSize={8}
                      fontWeight={500}
                      fontFamily="ui-monospace, monospace"
                      opacity={0.8}
                    >
                      {progress}
                    </text>
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
              {waveProgress?.[tooltip.impl.slug] && (
                <div className="text-xs opacity-80 mt-1">
                  Wave: <span className="font-medium">{waveProgress[tooltip.impl.slug]}</span>
                </div>
              )}
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
