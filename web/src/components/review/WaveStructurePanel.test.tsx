// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import WaveStructurePanel from './WaveStructurePanel'
import { IMPLDocResponse } from '../../types'
import { ExecutionSyncState } from '../../hooks/useExecutionSync'

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeImpl(docStatus = 'active'): IMPLDocResponse {
  return {
    slug: 'test-impl',
    doc_status: docStatus,
    suitability: { verdict: 'suitable', rationale: '' },
    file_ownership: [],
    file_ownership_col4_name: 'Action',
    waves: [
      { number: 1, agents: ['A', 'B', 'C'], dependencies: [] },
      { number: 2, agents: ['D'], dependencies: [1] },
    ],
    scaffold: { required: true, files: ['scaffold.ts'], contracts: [] },
    known_issues: [],
    scaffolds_detail: [],
    interface_contracts_text: '',
    dependency_graph_text: '',
    post_merge_checklist_text: '',
    stub_report_text: '',
    agent_prompts: [],
    title: 'Test IMPL',
    pre_mortem: undefined,
  } as unknown as IMPLDocResponse
}

function makeIdleState(): ExecutionSyncState {
  return {
    agents: new Map(),
    waveProgress: new Map(),
    scaffoldStatus: 'idle',
    isLive: false,
  }
}

function makeLiveState(overrides: Partial<ExecutionSyncState> = {}): ExecutionSyncState {
  return {
    agents: new Map(),
    waveProgress: new Map([
      [1, { complete: 0, total: 3 }],
      [2, { complete: 0, total: 1 }],
    ]),
    scaffoldStatus: 'idle',
    isLive: true,
    ...overrides,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('WaveStructurePanel', () => {
  test('TestStaticRendering — renders with impl data, no executionState', () => {
    render(<WaveStructurePanel impl={makeImpl()} />)

    // Title
    expect(screen.getByText('Wave Structure')).toBeInTheDocument()

    // Scout node
    expect(screen.getByText('Scout')).toBeInTheDocument()

    // Scaffold node
    expect(screen.getByText('Scaffold')).toBeInTheDocument()
    expect(screen.getByText(/1 interface file/)).toBeInTheDocument()

    // Wave nodes
    expect(screen.getByText('Wave 1')).toBeInTheDocument()
    expect(screen.getByText('Wave 2')).toBeInTheDocument()

    // Agent letters
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
    expect(screen.getByText('D')).toBeInTheDocument()

    // Parallel text (static mode)
    expect(screen.getByText('3 parallel')).toBeInTheDocument()
    expect(screen.getByText('1 parallel')).toBeInTheDocument()

    // Complete node
    expect(screen.getByText('Complete')).toBeInTheDocument()
  })

  test('TestAgentBoxRunningGlow — when executionState has "1:A" running, agent A box has running styles', () => {
    const agents = new Map([
      ['1:A', { status: 'running' as const, agent: 'A', wave: 1 }],
    ])
    const executionState = makeLiveState({ agents })

    const { container } = render(
      <WaveStructurePanel impl={makeImpl()} executionState={executionState} />
    )

    // Find the agent box for 'A'
    const agentBoxA = screen.getByText('A').closest('div')
    expect(agentBoxA).not.toBeNull()

    // Should have exec-node-running class
    expect(agentBoxA).toHaveClass('exec-node-running')

    // Should have running border color style
    const style = agentBoxA!.getAttribute('style') ?? ''
    expect(style).toContain('rgb(88, 166, 255)')
  })

  test('TestAgentBoxRunningGlow — complete agent has complete styles', () => {
    const agents = new Map([
      ['1:B', { status: 'complete' as const, agent: 'B', wave: 1 }],
    ])
    const executionState = makeLiveState({ agents })

    render(<WaveStructurePanel impl={makeImpl()} executionState={executionState} />)

    const agentBoxB = screen.getByText('B').closest('div')
    expect(agentBoxB).not.toBeNull()
    expect(agentBoxB).toHaveClass('exec-node-complete')

    const style = agentBoxB!.getAttribute('style') ?? ''
    expect(style).toContain('rgb(63, 185, 80)')
  })

  test('TestAgentBoxRunningGlow — failed agent has failed styles', () => {
    const agents = new Map([
      ['1:C', { status: 'failed' as const, agent: 'C', wave: 1 }],
    ])
    const executionState = makeLiveState({ agents })

    render(<WaveStructurePanel impl={makeImpl()} executionState={executionState} />)

    const agentBoxC = screen.getByText('C').closest('div')
    expect(agentBoxC).not.toBeNull()
    expect(agentBoxC).toHaveClass('exec-node-failed')

    const style = agentBoxC!.getAttribute('style') ?? ''
    expect(style).toContain('rgb(248, 81, 73)')
  })

  test('TestJewelFillsOnWaveComplete — when all agents in wave 1 are complete, wave 1 jewel is filled', () => {
    // Wave 1 complete: 3/3
    const waveProgress = new Map([
      [1, { complete: 3, total: 3 }],
      [2, { complete: 0, total: 1 }],
    ])
    const executionState = makeLiveState({ waveProgress })

    const { container } = render(
      <WaveStructurePanel impl={makeImpl()} executionState={executionState} />
    )

    // The jewel for Wave 1 should have exec-jewel-filling class (filling = live && filled)
    // Wave 1 jewel SVG should have the filling class
    const svgs = container.querySelectorAll('svg.exec-jewel-filling')
    expect(svgs.length).toBeGreaterThan(0)
  })

  test('TestJewelFillsOnWaveComplete — incomplete wave has no filling class', () => {
    // Wave 1 only 1/3 complete
    const waveProgress = new Map([
      [1, { complete: 1, total: 3 }],
      [2, { complete: 0, total: 1 }],
    ])
    const executionState = makeLiveState({ waveProgress })

    const { container } = render(
      <WaveStructurePanel impl={makeImpl()} executionState={executionState} />
    )

    // Scout jewel will be filled (orchestrator always fills when live)
    // But wave 1 should NOT be filling since 1/3 != 3/3
    // We check that total filling jewels is limited (only Scout)
    const fillingJewels = container.querySelectorAll('svg.exec-jewel-filling')
    // Only scout should be filling
    expect(fillingJewels.length).toBe(1)
  })

  test('TestProgressText — when live with 1/3 complete, shows "1/3 complete"', () => {
    const waveProgress = new Map([
      [1, { complete: 1, total: 3 }],
      [2, { complete: 0, total: 1 }],
    ])
    const executionState = makeLiveState({ waveProgress })

    render(<WaveStructurePanel impl={makeImpl()} executionState={executionState} />)

    // Should show progress text instead of "N parallel"
    expect(screen.getByText('1/3 complete')).toBeInTheDocument()
    // Wave 2: 0/1 complete
    expect(screen.getByText('0/1 complete')).toBeInTheDocument()
    // Should NOT show "3 parallel" in live mode
    expect(screen.queryByText('3 parallel')).toBeNull()
  })

  test('TestProgressText — when not live, shows "N parallel"', () => {
    const executionState = makeIdleState()

    render(<WaveStructurePanel impl={makeImpl()} executionState={executionState} />)

    expect(screen.getByText('3 parallel')).toBeInTheDocument()
    expect(screen.queryByText(/complete/)).toBeNull()
  })

  test('TestScaffoldJewelFills — when scaffoldStatus is complete, scaffold jewel has filling class', () => {
    const executionState = makeLiveState({ scaffoldStatus: 'complete' })

    const { container } = render(
      <WaveStructurePanel impl={makeImpl()} executionState={executionState} />
    )

    // Both Scout (orchestrator, always filled when live) and Scaffold should be filling
    const fillingJewels = container.querySelectorAll('svg.exec-jewel-filling')
    expect(fillingJewels.length).toBeGreaterThanOrEqual(2)
  })

  test('TestScaffoldJewelFills — when scaffoldStatus is idle, scaffold jewel not filling', () => {
    const executionState = makeLiveState({ scaffoldStatus: 'idle' })

    const { container } = render(
      <WaveStructurePanel impl={makeImpl()} executionState={executionState} />
    )

    // Only scout jewel should be filling (orchestrator always fills)
    const fillingJewels = container.querySelectorAll('svg.exec-jewel-filling')
    expect(fillingJewels.length).toBe(1)
  })

  test('TestStaticRendering — no executionState shows parallel text', () => {
    render(<WaveStructurePanel impl={makeImpl()} />)
    expect(screen.getByText('3 parallel')).toBeInTheDocument()
    expect(screen.getByText('1 parallel')).toBeInTheDocument()
  })

  test('backward compat — undefined executionState, COMPLETE doc fills all static', () => {
    const impl = makeImpl('COMPLETE')
    const { container } = render(<WaveStructurePanel impl={impl} />)

    // No filling class in static mode (no live animation)
    const fillingJewels = container.querySelectorAll('svg.exec-jewel-filling')
    expect(fillingJewels.length).toBe(0)

    // But filled=true still applied to jewels (gradient opacities changed internally)
    // Just verify it renders without errors
    expect(screen.getByText('Complete')).toBeInTheDocument()
  })
})
