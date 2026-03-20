// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import OverviewPanel from './OverviewPanel'
import { IMPLDocResponse } from '../../types'

// --- Fixtures ---

function makeImpl(overrides: Partial<{ verdict: string; rationale: string }> = {}): IMPLDocResponse {
  return {
    title: 'Test IMPL',
    slug: 'test',
    date: '2024-01-01',
    status: 'draft',
    suitability: {
      verdict: overrides.verdict ?? 'SUITABLE',
      rationale: overrides.rationale ?? '',
    },
    file_ownership: [
      { file: 'web/src/Foo.tsx', agent: 'A', wave: 1, action: 'new', depends_on: '' },
      { file: 'web/src/Bar.tsx', agent: 'B', wave: 1, action: 'modify', depends_on: '' },
      { file: 'web/src/Baz.tsx', agent: 'A', wave: 2, action: 'new', depends_on: '' },
    ],
    file_ownership_col4_name: 'Action',
    waves: [
      { wave: 1, agents: ['A', 'B'] },
      { wave: 2, agents: ['A'] },
    ],
    scaffold: { description: '' },
    known_issues: [],
    scaffolds_detail: [],
    interface_contracts_text: '',
    dependency_graph_text: '',
    post_merge_checklist_text: '',
    stub_report_text: '',
    agent_prompts: [],
    repos: [],
    overview: '',
    not_suitable_for_research: '',
    pre_mortem: undefined,
  } as unknown as IMPLDocResponse
}

// --- Tests ---

describe('OverviewPanel', () => {
  test('renders file count, agent count, and wave count', () => {
    render(<OverviewPanel impl={makeImpl()} />)
    expect(screen.getByText('3 files')).toBeDefined()
    expect(screen.getByText('2 agents')).toBeDefined()
    expect(screen.getByText('2 waves')).toBeDefined()
  })

  test('renders singular "wave" when only 1 wave', () => {
    const impl = makeImpl()
    impl.waves = [{ wave: 1, agents: ['A'] }]
    render(<OverviewPanel impl={impl} />)
    expect(screen.getByText('1 wave')).toBeDefined()
  })

  test('wraps SUITABLE verdict in tooltip with dotted underline', () => {
    render(<OverviewPanel impl={makeImpl()} />)
    const suitableSpan = screen.getByText('SUITABLE')
    expect(suitableSpan.className).toContain('underline')
    expect(suitableSpan.className).toContain('decoration-dotted')
  })

  test('does not wrap non-SUITABLE verdict in tooltip', () => {
    render(<OverviewPanel impl={makeImpl({ verdict: 'NOT SUITABLE' })} />)
    const verdictText = screen.getByText('NOT SUITABLE')
    // Should not have tooltip dotted underline styling
    expect(verdictText.className).not.toContain('decoration-dotted')
  })

  test('stat tooltips have role="tooltip"', () => {
    render(<OverviewPanel impl={makeImpl()} />)
    const tooltips = screen.getAllByRole('tooltip')
    // 4 tooltips: SUITABLE verdict + files + agents + waves
    expect(tooltips.length).toBe(4)
  })

  test('files tooltip contains I1 invariant explanation', () => {
    render(<OverviewPanel impl={makeImpl()} />)
    const tooltips = screen.getAllByRole('tooltip')
    const tooltipTexts = tooltips.map(t => t.textContent)
    expect(tooltipTexts.some(t => t?.includes('I1 invariant'))).toBe(true)
  })

  test('agents tooltip contains interface contracts explanation', () => {
    render(<OverviewPanel impl={makeImpl()} />)
    const tooltips = screen.getAllByRole('tooltip')
    const tooltipTexts = tooltips.map(t => t.textContent)
    expect(tooltipTexts.some(t => t?.includes('interface contracts'))).toBe(true)
  })

  test('waves tooltip contains parallel execution explanation', () => {
    render(<OverviewPanel impl={makeImpl()} />)
    const tooltips = screen.getAllByRole('tooltip')
    const tooltipTexts = tooltips.map(t => t.textContent)
    expect(tooltipTexts.some(t => t?.includes('Agents within a wave run in parallel'))).toBe(true)
  })

  test('rationale toggle still works', () => {
    render(<OverviewPanel impl={makeImpl({ rationale: 'Good decomposition' })} />)
    // Click the verdict button to show rationale
    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(screen.getByText('Good decomposition')).toBeDefined()
  })

  test('all stat spans have dotted underline class', () => {
    render(<OverviewPanel impl={makeImpl()} />)
    const filesSpan = screen.getByText('3 files')
    const agentsSpan = screen.getByText('2 agents')
    const wavesSpan = screen.getByText('2 waves')
    for (const el of [filesSpan, agentsSpan, wavesSpan]) {
      expect(el.className).toContain('underline')
      expect(el.className).toContain('decoration-dotted')
    }
  })
})
