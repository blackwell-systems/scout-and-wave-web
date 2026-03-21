import { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react'
import { IMPLDocResponse } from '../../types'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { getAgentColor, getAgentColorWithOpacity } from '../../lib/agentColors'
import { ExecutionSyncState } from '../../hooks/useExecutionSync'

interface WaveStructurePanelProps {
  impl: IMPLDocResponse
  executionState?: ExecutionSyncState
}

type NodeType = 'orchestrator' | 'wave' | 'scaffold' | 'merge' | 'complete'

interface TimelineNode {
  type: NodeType
  label: string
  description?: string
  agents?: string[]
  agentCount?: number
  scaffoldFiles?: number
  waveNum?: number
}

// Wave colors matching the dependency graph — each wave gets a distinct hue.
const WAVE_COLORS = [
  '#3b82f6', // wave 1 — blue
  '#ec4899', // wave 2 — pink
  '#22c55e', // wave 3 — green
  '#f59e0b', // wave 4 — amber
  '#6366f1', // wave 5 — indigo
  '#14b8a6', // wave 6 — teal
]

// Node type base colors for non-wave nodes
const NODE_COLORS: Record<NodeType, string> = {
  orchestrator: '#06b6d4', // cyan — distinct from waves but subtle
  scaffold: '#f59e0b',
  wave: '#3b82f6',         // fallback, overridden per-wave
  merge: '#94a3b8',        // lighter slate for small merge dots
  complete: '#7c3aed',
}

function getNodeColor(node: TimelineNode): string {
  if (node.type === 'wave' && node.waveNum !== undefined) {
    return WAVE_COLORS[(node.waveNum - 1) % WAVE_COLORS.length]
  }
  if (node.type === 'merge' && node.waveNum !== undefined) {
    return WAVE_COLORS[(node.waveNum - 1) % WAVE_COLORS.length]
  }
  return NODE_COLORS[node.type]
}

let orbCounter = 0

function Orb({ color, filled, filling, size = 20, type, totalSegments, filledSegments }: {
  color: string
  filled: boolean
  filling?: boolean
  size?: number
  type: NodeType
  /** Number of horizontal partitions (e.g. agent count) */
  totalSegments?: number
  /** How many segments are filled (bottom to top) */
  filledSegments?: number
}) {
  const [uid] = useState(() => `orb-${++orbCounter}`)
  const r = size / 2
  const prevFilled = useRef(filled)
  const prevFilledSegs = useRef(filledSegments ?? 0)
  const [justFilled, setJustFilled] = useState(false)
  const [justFilledSeg, setJustFilledSeg] = useState(-1)

  // Detect unfilled → filled transition (whole orb)
  useLayoutEffect(() => {
    if (filled && !prevFilled.current) {
      setJustFilled(true)
      const timer = setTimeout(() => setJustFilled(false), 800)
      return () => clearTimeout(timer)
    }
    prevFilled.current = filled
  }, [filled])

  // Detect individual segment fill transitions
  useLayoutEffect(() => {
    const cur = filledSegments ?? 0
    const prev = prevFilledSegs.current
    if (cur > prev && !filled) {
      setJustFilledSeg(cur - 1)
      const timer = setTimeout(() => setJustFilledSeg(-1), 600)
      prevFilledSegs.current = cur
      return () => clearTimeout(timer)
    }
    prevFilledSegs.current = cur
  }, [filledSegments, filled])

  // Derive lighter/darker shades from the base color
  const lightColor = color + '80'
  const midColor = color
  const darkColor = color + 'cc'

  const isSegmented = totalSegments !== undefined && totalSegments > 0 && !filled
  const segCount = totalSegments ?? 0
  const segFilled = filledSegments ?? 0

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`flex-shrink-0 ${filling && !justFilled ? 'scale-110' : ''}`}
      style={{
        filter: filled
          ? `drop-shadow(0 0 ${justFilled ? 12 : 6}px ${color}${justFilled ? 'aa' : '60'})`
          : segFilled > 0
            ? `drop-shadow(0 0 4px ${color}40)`
            : undefined,
        transform: justFilled ? 'scale(1.35)' : undefined,
        transition: justFilled
          ? 'transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.15s ease-out'
          : 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), filter 0.5s ease-out',
      }}
    >
      <defs>
        <radialGradient id={`${uid}-grad`} cx="35%" cy="35%" r="65%">
          <stop offset="0%" stopColor={lightColor} stopOpacity={filled ? 1 : 0.3}>
            <animate attributeName="stop-opacity" from={filled ? '0.3' : '0.3'} to={filled ? '1' : '0.3'} dur="0.7s" fill="freeze" />
          </stop>
          <stop offset="50%" stopColor={midColor} stopOpacity={filled ? 0.85 : 0.15}>
            <animate attributeName="stop-opacity" from={filled ? '0.15' : '0.15'} to={filled ? '0.85' : '0.15'} dur="0.7s" fill="freeze" />
          </stop>
          <stop offset="100%" stopColor={darkColor} stopOpacity={filled ? 0.7 : 0.1}>
            <animate attributeName="stop-opacity" from={filled ? '0.1' : '0.1'} to={filled ? '0.7' : '0.1'} dur="0.7s" fill="freeze" />
          </stop>
        </radialGradient>
        <radialGradient id={`${uid}-hl`} cx="30%" cy="25%" r="35%">
          <stop offset="0%" stopColor="white" stopOpacity={filled ? 0.7 : 0.3} />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        {/* Shine burst gradient — expands outward on fill */}
        <radialGradient id={`${uid}-shine`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="white" stopOpacity="0.8" />
          <stop offset="60%" stopColor="white" stopOpacity="0.2" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        {/* Clip path for segmented fills — circle shape */}
        <clipPath id={`${uid}-clip`}>
          <circle cx={r} cy={r} r={r - 1.5} />
        </clipPath>
      </defs>
      {/* Outer glow ring — only when filled */}
      {filled && (
        <circle cx={r} cy={r} r={r - 0.5} fill={midColor} opacity={0.2}>
          <animate attributeName="opacity" from="0" to="0.2" dur="0.5s" fill="freeze" />
        </circle>
      )}
      {/* Body — unfilled base or full gradient when completely filled */}
      <circle
        cx={r} cy={r} r={r - 1.5}
        fill={isSegmented ? `${midColor}15` : `url(#${uid}-grad)`}
        stroke={midColor}
        strokeWidth={filled ? 1.5 : 1}
        strokeOpacity={filled ? 0.8 : 0.3}
      />
      {/* Segmented fill — horizontal partitions filling bottom-to-top */}
      {isSegmented && (
        <g clipPath={`url(#${uid}-clip)`}>
          {Array.from({ length: segCount }, (_, i) => {
            const segHeight = (size - 3) / segCount
            const gap = 0.5
            // Segments indexed bottom-to-top: segment 0 is at the bottom
            const y = (size - 1.5) - (i + 1) * segHeight + gap / 2
            const isFilled = i < segFilled
            const isJustFilled = i === justFilledSeg
            return (
              <rect
                key={i}
                x={1.5}
                y={y}
                width={size - 3}
                height={segHeight - gap}
                rx={0.5}
                fill={isFilled ? midColor : 'transparent'}
                opacity={isFilled ? (isJustFilled ? 1 : 0.75) : 0}
              >
                {isFilled && (
                  <animate
                    attributeName="opacity"
                    from="0"
                    to={isJustFilled ? '1' : '0.75'}
                    dur="0.4s"
                    fill="freeze"
                  />
                )}
              </rect>
            )
          })}
          {/* Thin separator lines between segments */}
          {Array.from({ length: segCount - 1 }, (_, i) => {
            const segHeight = (size - 3) / segCount
            const y = (size - 1.5) - (i + 1) * segHeight
            return (
              <line
                key={`sep-${i}`}
                x1={1.5}
                y1={y}
                x2={size - 1.5}
                y2={y}
                stroke={midColor}
                strokeWidth={0.5}
                strokeOpacity={0.2}
              />
            )
          })}
        </g>
      )}
      {/* Inner highlight — glassy reflection */}
      <circle cx={r} cy={r} r={r - 2.5} fill={`url(#${uid}-hl)`} />
      {/* Shine burst — plays once on fill transition */}
      {justFilled && (
        <circle cx={r} cy={r} r={r - 1} fill={`url(#${uid}-shine)`}>
          <animate attributeName="r" from={`${r * 0.3}`} to={`${r + 2}`} dur="0.6s" fill="freeze" />
          <animate attributeName="opacity" from="1" to="0" dur="0.6s" fill="freeze" />
        </circle>
      )}
      {/* Completion ring */}
      {type === 'complete' && filled && (
        <circle cx={r} cy={r} r={r - 0.5} fill="none" stroke={lightColor} strokeWidth="0.75" strokeOpacity={0.6}>
          <animate attributeName="stroke-opacity" from="0" to="0.6" dur="0.8s" fill="freeze" />
        </circle>
      )}
    </svg>
  )
}

function getAgentBoxStyle(
  letter: string,
  waveNum: number,
  executionState: ExecutionSyncState | undefined
): React.CSSProperties {
  if (!executionState || executionState.agents.size === 0) return {}
  const exec = executionState.agents.get(`${waveNum}:${letter}`)
  if (!exec) return {}
  switch (exec.status) {
    case 'running':
      return {
        borderColor: 'rgb(88, 166, 255)',
        boxShadow: '0 0 12px rgba(88, 166, 255, 0.4)',
      }
    case 'complete':
      return {
        borderColor: 'rgb(63, 185, 80)',
        boxShadow: '0 0 10px rgba(63, 185, 80, 0.3)',
      }
    case 'failed':
      return {
        borderColor: 'rgb(248, 81, 73)',
        boxShadow: '0 0 12px rgba(248, 81, 73, 0.5)',
      }
    default:
      return {}
  }
}

function getAgentBoxClassName(
  letter: string,
  waveNum: number,
  executionState: ExecutionSyncState | undefined
): string {
  if (!executionState || executionState.agents.size === 0) return ''
  const exec = executionState.agents.get(`${waveNum}:${letter}`)
  if (!exec) return ''
  switch (exec.status) {
    case 'running':
      return 'exec-node-running'
    case 'complete':
      return 'exec-node-complete'
    case 'failed':
      return 'exec-node-failed'
    default:
      return ''
  }
}

export default function WaveStructurePanel({ impl, executionState }: WaveStructurePanelProps): JSX.Element {
  const sortedWaves = useMemo(() => [...impl.waves].sort((a, b) => a.number - b.number), [impl.waves])
  const isComplete = impl.doc_status === 'complete'
  const isLive = executionState?.isLive ?? false

  // Build timeline nodes — memoized to avoid triggering the segment-layout effect on every render
  const nodes: TimelineNode[] = useMemo(() => {
    const result: TimelineNode[] = []

    result.push({ type: 'orchestrator', label: 'Scout', description: 'Analyze codebase and produce IMPL doc' })

    if (impl.scaffold.required) {
      result.push({
        type: 'scaffold',
        label: 'Scaffold',
        scaffoldFiles: impl.scaffold.files?.length ?? 0,
      })
    }

    sortedWaves.forEach((wave, i) => {
      const agents = wave.agents ?? []
      result.push({
        type: 'wave',
        label: `Wave ${wave.number}`,
        agents,
        agentCount: agents.length,
        waveNum: wave.number,
      })
      result.push({
        type: 'merge',
        label: 'Merge',
        description: i < sortedWaves.length - 1
          ? `Merge ${wave.agents.length} branches, verify, gate Wave ${wave.number + 1}`
          : `Merge ${wave.agents.length} branches, final verification`,
        waveNum: wave.number,
      })
    })

    result.push({ type: 'complete', label: 'Complete', description: 'All waves merged and verified' })
    return result
  }, [impl.scaffold.required, impl.scaffold.files, sortedWaves])

  // Compute filled state per node.
  // Uses executionState when available (live or disk-seeded), falls back to
  // isComplete for nodes that can't be determined from agent data alone.
  // Look up wave status from the IMPL doc data (persisted, not just live SSE)
  const getWaveStatus = useCallback((waveNum: number): string => {
    const wave = sortedWaves.find(w => w.number === waveNum)
    return wave?.status ?? 'pending'
  }, [sortedWaves])

  // Determine the highest completed wave number from the IMPL doc.
  // This is the single source of truth — no reliance on SSE or execution state.
  const highestCompleteWave = useMemo(() => {
    let highest = 0
    for (const w of sortedWaves) {
      if (w.status === 'complete') highest = w.number
    }
    return highest
  }, [sortedWaves])

  // Check if a wave is actively running via live execution state
  const isWaveRunning = useCallback((waveNum: number): boolean => {
    if (!isLive || !executionState) return false
    const progress = executionState.waveProgress.get(waveNum)
    return !!progress
  }, [isLive, executionState])

  const isNodeFilled = useCallback((node: TimelineNode): boolean => {
    if (isComplete) return true

    switch (node.type) {
      case 'orchestrator':
        // Scout always ran — we're viewing its output
        return true

      case 'scaffold':
        // Filled only when scaffold files have been committed, or when live
        // execution reports scaffold complete.
        if (isLive && executionState) return executionState.scaffoldStatus === 'complete'
        return impl.scaffold.committed

      case 'wave':
        return getWaveStatus(node.waveNum!) === 'complete'

      case 'merge':
        // Merge is done if this wave completed (merge happens before next wave can start)
        return getWaveStatus(node.waveNum!) === 'complete'

      case 'complete':
        // Fill when all waves are complete (final merge done)
        return sortedWaves.length > 0 && sortedWaves.every(w => w.status === 'complete')

      default:
        return false
    }
  }, [isComplete, highestCompleteWave, getWaveStatus, isLive, executionState, isWaveRunning, impl.scaffold.committed])

  // Track node element positions for per-segment colored lines
  const railRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([])
  const [segments, setSegments] = useState<{ top: number; height: number; color: string }[]>([])

  // Compute colored line segments between filled orbs.
  // Each segment extends from one filled node to the next, colored by the node it starts from.
  useEffect(() => {
    if (!railRef.current) return
    const railTop = railRef.current.getBoundingClientRect().top

    // Compute each orb's top and bottom edge relative to the rail.
    // nodeRefs point to the content div; the orb is at top:14 (20px) or top:2 (12px merge).
    const filled: { top: number; bottom: number; color: string }[] = []
    for (let i = 0; i < nodes.length; i++) {
      const el = nodeRefs.current[i]
      if (!el || !isNodeFilled(nodes[i])) continue
      const rect = el.getBoundingClientRect()
      const isMerge = nodes[i].type === 'merge'
      const orbTopOffset = isMerge ? 2 : 14
      const orbSize = isMerge ? 12 : 20
      const orbTop = rect.top + orbTopOffset - railTop
      filled.push({ top: orbTop, bottom: orbTop + orbSize, color: getNodeColor(nodes[i]) })
    }

    // Each node's color extends from its own top edge to the next node's top edge.
    // This means each orb has its OWN color behind it, and the previous color
    // stops exactly where the next orb starts — no protrusion.
    const segs: { top: number; height: number; color: string }[] = []
    for (let i = 0; i < filled.length - 1; i++) {
      segs.push({
        top: filled[i].top,
        height: filled[i + 1].top - filled[i].top,
        color: filled[i].color,
      })
    }
    // Cover the last orb with its own color
    if (filled.length > 0) {
      const last = filled[filled.length - 1]
      segs.push({ top: last.top, height: last.bottom - last.top, color: last.color })

      // Extend line to the next node if it's a running wave (line reaches it, orb stays unfilled)
      const lastFilledIdx = nodes.findIndex((n, i) => {
        const el = nodeRefs.current[i]
        if (!el || !isNodeFilled(n)) return false
        const rect = el.getBoundingClientRect()
        const isMerge = n.type === 'merge'
        const orbTop = rect.top + (isMerge ? 2 : 14) - railTop
        return Math.abs(orbTop - last.top) < 1
      })
      if (lastFilledIdx >= 0 && lastFilledIdx + 1 < nodes.length) {
        const nextNode = nodes[lastFilledIdx + 1]
        const nextEl = nodeRefs.current[lastFilledIdx + 1]
        const nextIsUncommittedScaffold = nextNode.type === 'scaffold' && !impl.scaffold.committed
        if (nextEl && ((nextNode.type === 'wave' && isWaveRunning(nextNode.waveNum!)) || nextIsUncommittedScaffold)) {
          const nextRect = nextEl.getBoundingClientRect()
          const nextOrbTop = nextRect.top + 14 - railTop
          // Extend the last segment to reach the running wave's orb top
          const lastSeg = segs[segs.length - 1]
          const extendTo = nextOrbTop // stop at the top of the unfilled orb
          lastSeg.height = extendTo - lastSeg.top
        }
      }
    }
    setSegments(segs)
  }, [nodes, isNodeFilled, isWaveRunning, executionState, impl.scaffold.committed])

  // Ensure refs array matches nodes length
  if (nodeRefs.current.length !== nodes.length) {
    nodeRefs.current = new Array(nodes.length).fill(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wave Structure</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative pl-8">
          {/* Background rail — always visible */}
          <div
            ref={railRef}
            className="absolute left-[9px] top-2 bottom-2 w-px bg-border"
          />

          {/* Colored line segments between filled orbs (z-0, behind orbs) */}
          {segments.map((seg, i) => (
            <div
              key={i}
              className="absolute left-[8px] w-[3px] rounded-full"
              style={{
                top: `calc(0.5rem + ${seg.top}px)`,
                height: `${seg.height}px`,
                backgroundColor: seg.color,
                opacity: 0.9,
                zIndex: 0,
              }}
            />
          ))}

          {nodes.map((node, i) => {
            const filled = isNodeFilled(node)
            let filling = isLive && filled
            // Scaffold orb only fills when scaffold execution completes
            if (node.type === 'scaffold' && isLive && executionState) {
              filling = executionState.scaffoldStatus === 'complete'
            }
            const color = getNodeColor(node)
            const orbSize = node.type === 'merge' ? 12 : 20

            // Compute segment data for wave orbs
            let totalSegments: number | undefined
            let filledSegments: number | undefined
            if (node.type === 'wave' && node.waveNum !== undefined && node.agentCount && node.agentCount > 1) {
              totalSegments = node.agentCount
              // Count completed agents from execution state
              if (executionState && executionState.agents.size > 0) {
                let count = 0
                for (const agent of node.agents ?? []) {
                  const exec = executionState.agents.get(`${node.waveNum}:${agent}`)
                  if (exec?.status === 'complete') count++
                }
                filledSegments = count
              } else if (filled) {
                filledSegments = totalSegments // all done
              } else {
                filledSegments = 0
              }
            }

            return (
              <div
                key={i}
                ref={el => { nodeRefs.current[i] = el }}
                className={`relative ${i > 0 ? (node.type === 'wave' || node.type === 'scaffold' ? 'mt-6' : 'mt-4') : ''}`}
              >
                {/* Orb on rail */}
                <div className="absolute -left-8 flex items-center justify-center w-5" style={{ top: node.type === 'merge' ? 2 : 14, zIndex: 1 }}>
                  <Orb
                    type={node.type}
                    color={color}
                    size={orbSize}
                    filled={filled}
                    filling={filling}
                    totalSegments={totalSegments}
                    filledSegments={filledSegments}
                  />
                </div>

                {node.type === 'wave' ? (
                  <div>
                    <div className="text-sm font-semibold text-foreground mb-2">{node.label}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {node.agents?.map(agentLetter => {
                        const agentColor = getAgentColor(agentLetter)
                        const bgColor = getAgentColorWithOpacity(agentLetter, 0.1)
                        const statusStyle = getAgentBoxStyle(agentLetter, node.waveNum!, executionState)
                        const statusClass = getAgentBoxClassName(agentLetter, node.waveNum!, executionState)
                        return (
                          <div
                            key={agentLetter}
                            className={`flex items-center justify-center w-12 h-12 rounded-lg font-semibold text-base border-2${statusClass ? ` ${statusClass}` : ''}`}
                            style={{
                              backgroundColor: bgColor,
                              borderColor: `${agentColor}50`,
                              color: agentColor,
                              ...statusStyle,
                            }}
                          >
                            {agentLetter}
                          </div>
                        )
                      })}
                      <span className="text-xs text-muted-foreground ml-1">
                        {isLive && node.waveNum !== undefined ? (() => {
                          const progress = executionState?.waveProgress.get(node.waveNum)
                          if (progress) {
                            return `${progress.complete}/${progress.total} complete`
                          }
                          return `${node.agentCount} parallel`
                        })() : `${node.agentCount} parallel`}
                      </span>
                    </div>
                  </div>
                ) : node.type === 'scaffold' ? (
                  <div>
                    <div className="text-sm font-semibold text-foreground mb-2">{node.label}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div
                        className={`flex items-center justify-center w-12 h-12 rounded-lg font-semibold text-base border-2${
                          isLive && executionState?.scaffoldStatus === 'running' ? ' exec-node-running' :
                          isLive && executionState?.scaffoldStatus === 'complete' ? ' exec-node-complete' :
                          isLive && executionState?.scaffoldStatus === 'failed' ? ' exec-node-failed' : ''
                        }`}
                        style={{
                          backgroundColor: isLive && executionState?.scaffoldStatus === 'failed'
                            ? 'rgba(248,81,73,0.15)' : isLive && executionState?.scaffoldStatus === 'running'
                            ? 'rgba(245,158,11,0.15)' : 'rgba(100,116,139,0.08)',
                          borderColor: isLive && executionState?.scaffoldStatus === 'failed'
                            ? 'rgb(248,81,73)' : isLive && executionState?.scaffoldStatus === 'running'
                            ? 'rgb(245,158,11)' : isLive && executionState?.scaffoldStatus === 'complete'
                            ? 'rgb(63,185,80)' : 'rgba(100,116,139,0.3)',
                          color: isLive && executionState?.scaffoldStatus === 'failed'
                            ? '#f85149' : isLive && executionState?.scaffoldStatus === 'running'
                            ? '#f59e0b' : '#64748b',
                          boxShadow: isLive && executionState?.scaffoldStatus === 'failed'
                            ? '0 0 12px rgba(248,81,73,0.5)' : isLive && executionState?.scaffoldStatus === 'running'
                            ? '0 0 12px rgba(245,158,11,0.4)' : isLive && executionState?.scaffoldStatus === 'complete'
                            ? '0 0 10px rgba(63,185,80,0.3)' : undefined,
                          '--exec-pulse-color': 'rgba(245,158,11,0.6)',
                        } as React.CSSProperties}
                      >
                        S
                      </div>
                      <span className="text-xs text-muted-foreground ml-1">
                        {isLive && executionState?.scaffoldStatus === 'running' ? 'Running...' :
                         isLive && executionState?.scaffoldStatus === 'complete' ? 'Done' :
                         `${node.scaffoldFiles} interface ${node.scaffoldFiles === 1 ? 'file' : 'files'}`}
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
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
