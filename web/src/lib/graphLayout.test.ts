import { describe, it, expect } from 'vitest'
import {
  layoutAgentWaves,
  transitiveReduce,
  AgentNode,
  LayoutOptions,
  PositionedAgent,
} from './graphLayout'

const defaultOpts: LayoutOptions = {
  nodeSize: 48,
  waveGap: 160,
  agentGap: 72,
  padX: 100,
  padY: 40,
}

function makeAgent(id: string, wave: number, deps: string[] = []): AgentNode {
  return { id, wave, dependencies: deps }
}

describe('layoutAgentWaves', () => {
  it('returns empty result for zero waves', () => {
    const result = layoutAgentWaves([], defaultOpts)
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
    expect(result.width).toBe(0)
    expect(result.height).toBe(0)
  })

  it('lays out a single wave with multiple agents in one row', () => {
    const waves = [
      { number: 1, agents: [makeAgent('A', 1), makeAgent('B', 1), makeAgent('C', 1)] },
    ]
    const result = layoutAgentWaves(waves, defaultOpts)

    expect(result.nodes).toHaveLength(3)
    // All agents should share the same y coordinate
    const ys = new Set(result.nodes.map(n => n.y))
    expect(ys.size).toBe(1)
    // Agents should be spaced apart horizontally
    const xs = result.nodes.map(n => n.x)
    expect(xs[1] - xs[0]).toBe(defaultOpts.agentGap)
    expect(xs[2] - xs[1]).toBe(defaultOpts.agentGap)
    // No edges since all in same wave
    expect(result.edges).toHaveLength(0)
  })

  it('lays out two waves with dependencies producing correct edges', () => {
    const waves = [
      { number: 1, agents: [makeAgent('A', 1), makeAgent('B', 1)] },
      { number: 2, agents: [makeAgent('C', 2, ['A']), makeAgent('D', 2, ['B'])] },
    ]
    const result = layoutAgentWaves(waves, defaultOpts)

    expect(result.nodes).toHaveLength(4)
    // Wave 1 agents should have smaller y than wave 2
    const wave1Y = result.nodes.find(n => n.agent.id === 'A')!.y
    const wave2Y = result.nodes.find(n => n.agent.id === 'C')!.y
    expect(wave2Y).toBeGreaterThan(wave1Y)
    expect(wave2Y - wave1Y).toBe(defaultOpts.waveGap)

    // Should have 2 edges: C->A and D->B
    expect(result.edges).toHaveLength(2)
    const edgeIds = result.edges.map(e => `${e.from.agent.id}->${e.to.agent.id}`)
    expect(edgeIds).toContain('C->A')
    expect(edgeIds).toContain('D->B')
  })

  it('handles a single agent with no dependencies', () => {
    const waves = [{ number: 1, agents: [makeAgent('A', 1)] }]
    const result = layoutAgentWaves(waves, defaultOpts)

    expect(result.nodes).toHaveLength(1)
    expect(result.edges).toHaveLength(0)
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
  })

  it('produces correct dimensions with configurable sizing', () => {
    const smallOpts: LayoutOptions = {
      nodeSize: 24,
      waveGap: 80,
      agentGap: 36,
      padX: 50,
      padY: 20,
    }
    const waves = [
      { number: 1, agents: [makeAgent('A', 1), makeAgent('B', 1)] },
      { number: 2, agents: [makeAgent('C', 2, ['A'])] },
    ]
    const result = layoutAgentWaves(waves, smallOpts)

    // Height = padY*2 + (waves-1)*waveGap + nodeSize = 20*2 + 80 + 24 = 144
    expect(result.height).toBe(144)
    // Width should be based on maxAgents=2: (padX-12) + (1*agentGap + nodeSize) + padX
    // = 38 + 60 + 50 = 148
    expect(result.width).toBe(148)
  })

  it('only creates cross-wave edges, not intra-wave edges', () => {
    const waves = [
      { number: 1, agents: [makeAgent('A', 1, ['B'])] },  // A depends on B but same wave
    ]
    // If there were only one wave, intra-wave deps are ignored for edges
    // (mirroring DependencyGraphPanel behavior)
    const waves2 = [
      { number: 1, agents: [makeAgent('A', 1, ['B']), makeAgent('B', 1)] },
    ]
    const result = layoutAgentWaves(waves2, defaultOpts)
    expect(result.edges).toHaveLength(0)
  })
})

describe('transitiveReduce', () => {
  it('removes redundant edges', () => {
    // A depends on B and C; B depends on C
    // Edge A->C is redundant because A->B->C exists
    const nodes: PositionedAgent[] = [
      { x: 0, y: 0, agent: makeAgent('A', 2, ['B', 'C']) },
      { x: 0, y: 100, agent: makeAgent('B', 1, ['C']) },
      { x: 100, y: 100, agent: makeAgent('C', 0, []) },
    ]
    const rawEdges = [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'B', to: 'C' },
    ]
    const reduced = transitiveReduce(nodes, rawEdges)

    // A->C should be removed because A->B->C exists
    expect(reduced).toHaveLength(2)
    const edgeKeys = reduced.map(e => `${e.from}->${e.to}`)
    expect(edgeKeys).toContain('A->B')
    expect(edgeKeys).toContain('B->C')
    expect(edgeKeys).not.toContain('A->C')
  })

  it('preserves all edges when no redundancy exists', () => {
    const nodes: PositionedAgent[] = [
      { x: 0, y: 0, agent: makeAgent('A', 2, ['B']) },
      { x: 0, y: 100, agent: makeAgent('B', 1, ['C']) },
      { x: 100, y: 100, agent: makeAgent('C', 0, []) },
    ]
    const rawEdges = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
    ]
    const reduced = transitiveReduce(nodes, rawEdges)
    expect(reduced).toHaveLength(2)
  })

  it('handles empty edges', () => {
    const nodes: PositionedAgent[] = [
      { x: 0, y: 0, agent: makeAgent('A', 1, []) },
    ]
    const reduced = transitiveReduce(nodes, [])
    expect(reduced).toEqual([])
  })

  it('handles diamond dependency pattern', () => {
    // A -> B, A -> C, B -> D, C -> D, A -> D
    // A->D is redundant (A->B->D or A->C->D)
    const nodes: PositionedAgent[] = [
      { x: 0, y: 0, agent: makeAgent('A', 3, ['B', 'C', 'D']) },
      { x: 0, y: 100, agent: makeAgent('B', 2, ['D']) },
      { x: 100, y: 100, agent: makeAgent('C', 2, ['D']) },
      { x: 50, y: 200, agent: makeAgent('D', 1, []) },
    ]
    const rawEdges = [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'A', to: 'D' },
      { from: 'B', to: 'D' },
      { from: 'C', to: 'D' },
    ]
    const reduced = transitiveReduce(nodes, rawEdges)

    const edgeKeys = reduced.map(e => `${e.from}->${e.to}`)
    expect(edgeKeys).toContain('A->B')
    expect(edgeKeys).toContain('A->C')
    expect(edgeKeys).toContain('B->D')
    expect(edgeKeys).toContain('C->D')
    expect(edgeKeys).not.toContain('A->D')
  })
})
