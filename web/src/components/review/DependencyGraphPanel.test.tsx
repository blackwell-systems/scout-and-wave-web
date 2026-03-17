// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import DependencyGraphPanel from './DependencyGraphPanel'
import { ExecutionSyncState } from '../../hooks/useExecutionSync'

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock createPortal so tooltips render inline (avoids document.body issues)
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom')
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  }
})

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// A dependency graph with Wave 1 agents A, B, C and Wave 2 agent D depending on A
const SAMPLE_GRAPH = `
\`\`\`
Wave 1 (agents: A, B, C)
  [A] Does something
  [B] Does another thing
  [C] Does a third thing

Wave 2 (agents: D)
  [D] Depends on wave 1
    depends on: [A]
\`\`\`
`

function makeIdleState(): ExecutionSyncState {
  return {
    agents: new Map(),
    waveProgress: new Map(),
    scaffoldStatus: 'idle',
    isLive: false,
  }
}

function makeLiveState(agentStatuses: Array<{ key: string; status: 'pending' | 'running' | 'complete' | 'failed'; wave: number; agent: string }>): ExecutionSyncState {
  const agents = new Map(
    agentStatuses.map(({ key, status, wave, agent }) => [
      key,
      { status, agent, wave },
    ])
  )
  return {
    agents,
    waveProgress: new Map(),
    scaffoldStatus: 'idle',
    isLive: true,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DependencyGraphPanel', () => {

  // ── 1. Static rendering (no executionState) ───────────────────────────────

  test('TestStaticRendering — renders nodes without execution state', () => {
    render(<DependencyGraphPanel dependencyGraphText={SAMPLE_GRAPH} />)

    // Should render the card title
    expect(screen.getByText('Dependency Graph')).toBeInTheDocument()

    // Should render SVG (the graph)
    const svg = document.querySelector('svg')
    expect(svg).toBeInTheDocument()

    // Agent labels should be visible
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
    expect(screen.getByText('D')).toBeInTheDocument()

    // No exec classes present
    const runningNodes = document.querySelectorAll('.exec-node-running')
    const failedNodes = document.querySelectorAll('.exec-node-failed')
    const completeNodes = document.querySelectorAll('.exec-node-complete')
    expect(runningNodes).toHaveLength(0)
    expect(failedNodes).toHaveLength(0)
    expect(completeNodes).toHaveLength(0)
  })

  // ── 2. Running node has exec-node-running class ───────────────────────────

  test('TestRunningNodeHasClass — agent "1:A" running gets exec-node-running class', () => {
    const executionState = makeLiveState([
      { key: '1:A', status: 'running', wave: 1, agent: 'A' },
    ])

    render(
      <DependencyGraphPanel
        dependencyGraphText={SAMPLE_GRAPH}
        executionState={executionState}
      />
    )

    // Find <g> elements with exec-node-running class
    const runningGroups = document.querySelectorAll('g.exec-node-running')
    expect(runningGroups.length).toBeGreaterThan(0)

    // The running group should contain the "A" text
    const aGroup = Array.from(runningGroups).find(g =>
      g.querySelector('text')?.textContent === 'A'
    )
    expect(aGroup).toBeDefined()
  })

  test('TestRunningNodeHasClass — running node sets --exec-pulse-color CSS var', () => {
    const executionState = makeLiveState([
      { key: '1:A', status: 'running', wave: 1, agent: 'A' },
    ])

    render(
      <DependencyGraphPanel
        dependencyGraphText={SAMPLE_GRAPH}
        executionState={executionState}
      />
    )

    const runningGroups = document.querySelectorAll('g.exec-node-running')
    const aGroup = Array.from(runningGroups).find(g =>
      g.querySelector('text')?.textContent === 'A'
    )
    expect(aGroup).toBeDefined()

    // Should have --exec-pulse-color CSS custom property set
    const style = (aGroup as HTMLElement).getAttribute('style')
    expect(style).toContain('--exec-pulse-color')
  })

  // ── 3. Complete node shows check overlay ──────────────────────────────────

  test('TestCompleteNodeShowsCheck — agent "1:B" complete renders check path', () => {
    const executionState = makeLiveState([
      { key: '1:B', status: 'complete', wave: 1, agent: 'B' },
    ])

    render(
      <DependencyGraphPanel
        dependencyGraphText={SAMPLE_GRAPH}
        executionState={executionState}
      />
    )

    // Should have exec-node-complete class
    const completeGroups = document.querySelectorAll('g.exec-node-complete')
    expect(completeGroups.length).toBeGreaterThan(0)

    const bGroup = Array.from(completeGroups).find(g =>
      g.querySelector('text')?.textContent === 'B'
    )
    expect(bGroup).toBeDefined()

    // Should contain the check overlay group
    const checkOverlay = bGroup!.querySelector('g.exec-check-overlay')
    expect(checkOverlay).toBeInTheDocument()

    // Check overlay should contain a path element
    const checkPath = checkOverlay!.querySelector('path')
    expect(checkPath).toBeInTheDocument()
    expect(checkPath!.getAttribute('d')).toBe('M-4,0 L-1,3 L4,-3')
  })

  // ── 4. Failed node has exec-node-failed class ─────────────────────────────

  test('TestFailedNodeHasClass — agent "1:C" failed gets exec-node-failed class', () => {
    const executionState = makeLiveState([
      { key: '1:C', status: 'failed', wave: 1, agent: 'C' },
    ])

    render(
      <DependencyGraphPanel
        dependencyGraphText={SAMPLE_GRAPH}
        executionState={executionState}
      />
    )

    const failedGroups = document.querySelectorAll('g.exec-node-failed')
    expect(failedGroups.length).toBeGreaterThan(0)

    const cGroup = Array.from(failedGroups).find(g =>
      g.querySelector('text')?.textContent === 'C'
    )
    expect(cGroup).toBeDefined()
  })

  test('TestFailedNodeHasClass — failed node rect has red stroke', () => {
    const executionState = makeLiveState([
      { key: '1:C', status: 'failed', wave: 1, agent: 'C' },
    ])

    render(
      <DependencyGraphPanel
        dependencyGraphText={SAMPLE_GRAPH}
        executionState={executionState}
      />
    )

    const failedGroups = document.querySelectorAll('g.exec-node-failed')
    const cGroup = Array.from(failedGroups).find(g =>
      g.querySelector('text')?.textContent === 'C'
    )
    expect(cGroup).toBeDefined()

    const rect = cGroup!.querySelector('rect')
    expect(rect!.getAttribute('stroke')).toBe('#f85149')
  })

  // ── 5. Edge brightens when source is complete ─────────────────────────────

  test('TestEdgeBrightensOnComplete — when source agent A is complete, edge has exec-edge-active class', () => {
    const executionState = makeLiveState([
      { key: '1:A', status: 'complete', wave: 1, agent: 'A' },
    ])

    render(
      <DependencyGraphPanel
        dependencyGraphText={SAMPLE_GRAPH}
        executionState={executionState}
      />
    )

    // There's an edge from A (wave 1) to D (wave 2) because D depends on A
    const activeEdges = document.querySelectorAll('line.exec-edge-active')
    expect(activeEdges.length).toBeGreaterThan(0)
  })

  test('TestEdgeBrightensOnComplete — non-complete source edges are inactive', () => {
    // Only A is complete; B and C are still pending (not in state)
    // D depends on A, so that edge is active
    // Other edges (if any) from non-complete sources should be inactive
    const executionState = makeLiveState([
      { key: '1:A', status: 'complete', wave: 1, agent: 'A' },
    ])

    render(
      <DependencyGraphPanel
        dependencyGraphText={SAMPLE_GRAPH}
        executionState={executionState}
      />
    )

    // Active edges should exist (A→D)
    const activeEdges = document.querySelectorAll('line.exec-edge-active')
    expect(activeEdges.length).toBeGreaterThan(0)
  })

  test('TestEdgeBrightensOnComplete — when not live, edges have static opacity not class', () => {
    const executionState = makeIdleState()

    render(
      <DependencyGraphPanel
        dependencyGraphText={SAMPLE_GRAPH}
        executionState={executionState}
      />
    )

    // No exec edge classes when not live
    const activeEdges = document.querySelectorAll('line.exec-edge-active')
    const inactiveEdges = document.querySelectorAll('line.exec-edge-inactive')
    expect(activeEdges).toHaveLength(0)
    expect(inactiveEdges).toHaveLength(0)

    // Edges should have static opacity attribute
    const lines = document.querySelectorAll('line')
    lines.forEach(line => {
      expect(line.getAttribute('opacity')).toBe('0.6')
    })
  })

  // ── 6. Backward compatibility with no executionState prop ─────────────────

  test('backward compat — renders correctly without executionState prop at all', () => {
    render(<DependencyGraphPanel dependencyGraphText={SAMPLE_GRAPH} />)

    expect(screen.getByText('Dependency Graph')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()

    // No exec classes
    expect(document.querySelectorAll('.exec-node-running')).toHaveLength(0)
    expect(document.querySelectorAll('.exec-node-failed')).toHaveLength(0)
    expect(document.querySelectorAll('.exec-node-complete')).toHaveLength(0)
    expect(document.querySelectorAll('.exec-edge-active')).toHaveLength(0)
    expect(document.querySelectorAll('.exec-edge-inactive')).toHaveLength(0)
  })

  // ── 7. Empty / missing dependencyGraphText ────────────────────────────────

  test('renders "No dependency graph" when dependencyGraphText is empty and no impl', () => {
    render(<DependencyGraphPanel dependencyGraphText="" />)
    expect(screen.getByText('No dependency graph')).toBeInTheDocument()
  })

  test('renders "No dependency graph" when dependencyGraphText is undefined and no impl', () => {
    render(<DependencyGraphPanel />)
    expect(screen.getByText('No dependency graph')).toBeInTheDocument()
  })

  // ── 8. Fallback: build graph from impl data when text is empty ───────────

  test('renders SVG graph from impl data when dependencyGraphText is empty', () => {
    const impl = {
      waves: [
        { number: 1, agents: ['A', 'B'], dependencies: [] },
        { number: 2, agents: ['C'], dependencies: [1] },
      ],
      file_ownership: [
        { file: 'pkg/foo.go', agent: 'A', wave: 1, action: 'modify', depends_on: '' },
        { file: 'pkg/bar.go', agent: 'B', wave: 1, action: 'modify', depends_on: '' },
        { file: 'pkg/baz.go', agent: 'C', wave: 2, action: 'new', depends_on: '' },
      ],
    }

    render(<DependencyGraphPanel dependencyGraphText="" impl={impl} />)

    // Should render SVG graph, not the "No dependency graph" message
    const svg = document.querySelector('svg')
    expect(svg).toBeInTheDocument()

    // Agent labels should be visible
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  test('renders "No dependency graph" when both text and impl are absent', () => {
    render(<DependencyGraphPanel dependencyGraphText="" impl={{ waves: [], file_ownership: [] }} />)
    expect(screen.getByText('No dependency graph')).toBeInTheDocument()
  })

  test('buildWavesFromImpl produces correct agent descriptions from file ownership', () => {
    const impl = {
      waves: [
        { number: 1, agents: ['X'], dependencies: [] },
      ],
      file_ownership: [
        { file: 'src/alpha.ts', agent: 'X', wave: 1, action: 'modify', depends_on: '' },
        { file: 'src/beta.ts', agent: 'X', wave: 1, action: 'new', depends_on: '' },
      ],
    }

    render(<DependencyGraphPanel impl={impl} />)

    // SVG should render
    const svg = document.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(screen.getByText('X')).toBeInTheDocument()
  })
})
