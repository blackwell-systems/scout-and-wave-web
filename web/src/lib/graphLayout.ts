/**
 * Shared wave-based agent layout algorithm.
 *
 * Extracted from DependencyGraphPanel so that both the existing dependency graph
 * and the new nested program graph can reuse the same positioning logic.
 *
 * Pure functions only — no React, no DOM, no side effects.
 */

export interface AgentNode {
  id: string
  wave: number
  dependencies: string[]
}

export interface PositionedAgent {
  x: number
  y: number
  agent: AgentNode
}

export interface AgentLayoutResult {
  nodes: PositionedAgent[]
  edges: Array<{ from: PositionedAgent; to: PositionedAgent }>
  width: number
  height: number
}

export interface LayoutOptions {
  nodeSize: number
  waveGap: number
  agentGap: number
  padX: number
  padY: number
}

/**
 * Perform transitive reduction on a set of edges.
 *
 * Given positioned nodes and raw directed edges (from → to), remove any edge
 * A→C where A can reach C through other edges without using the direct A→C
 * edge. This keeps the graph visually clean without losing reachability.
 */
export function transitiveReduce(
  nodes: PositionedAgent[],
  rawEdges: Array<{ from: string; to: string }>
): Array<{ from: string; to: string }> {
  // Build adjacency map: for each node, the set of nodes it depends on (points to)
  const adjMap = new Map<string, Set<string>>()
  for (const node of nodes) {
    if (!adjMap.has(node.agent.id)) {
      adjMap.set(node.agent.id, new Set<string>())
    }
  }
  for (const edge of rawEdges) {
    const deps = adjMap.get(edge.from)
    if (deps) {
      deps.add(edge.to)
    }
  }

  // Check if `from` can reach `target` without using the direct from→target edge
  function isReachableWithout(from: string, target: string): boolean {
    const visited = new Set<string>()
    const stack: string[] = []
    // Seed with all neighbors of `from` except `target`
    const neighbors = adjMap.get(from)
    if (neighbors) {
      for (const n of neighbors) {
        if (n !== target) stack.push(n)
      }
    }
    while (stack.length > 0) {
      const cur = stack.pop()!
      if (cur === target) return true
      if (visited.has(cur)) continue
      visited.add(cur)
      const deps = adjMap.get(cur)
      if (deps) {
        for (const d of deps) {
          stack.push(d)
        }
      }
    }
    return false
  }

  return rawEdges.filter(edge => !isReachableWithout(edge.from, edge.to))
}

/**
 * Layout agent nodes in wave rows with transitive-reduced dependency edges.
 *
 * Groups agents by wave number, centers each row horizontally, computes
 * cross-wave edges with transitive reduction.
 */
export function layoutAgentWaves(
  waves: Array<{ number: number; agents: AgentNode[] }>,
  opts: LayoutOptions
): AgentLayoutResult {
  if (waves.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 }
  }

  const { nodeSize, waveGap, agentGap, padX, padY } = opts

  // Determine the maximum number of agents in any single wave (for width calc)
  const maxAgents = Math.max(...waves.map(w => w.agents.length), 1)

  // Compute canvas dimensions
  const bandLeft = padX - 12
  const agentAreaWidth = (maxAgents - 1) * agentGap + nodeSize
  const width = bandLeft + agentAreaWidth + padX
  const bandRight = width - 4
  const bandCenter = (bandLeft + bandRight) / 2

  // Position each agent
  const nodes: PositionedAgent[] = []
  for (let wi = 0; wi < waves.length; wi++) {
    const wave = waves[wi]
    const y = padY + wi * waveGap
    const totalWidth = (wave.agents.length - 1) * agentGap + nodeSize
    const startX = bandCenter - totalWidth / 2

    for (let ai = 0; ai < wave.agents.length; ai++) {
      nodes.push({
        x: startX + ai * agentGap,
        y,
        agent: wave.agents[ai],
      })
    }
  }

  const height = padY * 2 + (waves.length - 1) * waveGap + nodeSize

  // Build a lookup from agent id to PositionedAgent
  const nodeMap = new Map<string, PositionedAgent>(nodes.map(n => [n.agent.id, n]))

  // Collect all raw cross-wave dependency edges
  const rawEdges: Array<{ from: string; to: string }> = []
  for (const node of nodes) {
    for (const dep of node.agent.dependencies) {
      const source = nodeMap.get(dep)
      if (source && source.agent.wave !== node.agent.wave) {
        // Edge direction: dependent node → its dependency (from → to)
        rawEdges.push({ from: node.agent.id, to: dep })
      }
    }
  }

  // Apply transitive reduction
  const reducedEdges = transitiveReduce(nodes, rawEdges)

  // Convert string edges to PositionedAgent edges
  const edges: Array<{ from: PositionedAgent; to: PositionedAgent }> = []
  for (const edge of reducedEdges) {
    const fromNode = nodeMap.get(edge.from)
    const toNode = nodeMap.get(edge.to)
    if (fromNode && toNode) {
      edges.push({ from: fromNode, to: toNode })
    }
  }

  return { nodes, edges, width, height }
}
