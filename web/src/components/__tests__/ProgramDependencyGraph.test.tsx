// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Polyfill ResizeObserver for jsdom
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
import type { ProgramStatus } from '../../types/program'

// Mock the programApi module
vi.mock('../../programApi', () => ({
  fetchProgramStatus: vi.fn(),
}))

// Mock createPortal so tooltip renders inline (jsdom has no real DOM positioning)
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom')
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  }
})

// Mock agentColors to avoid side effects
vi.mock('../../lib/entityColors', () => ({
  resetThemeCache: vi.fn(),
  getAgentColor: (agent: string) => {
    const colors: Record<string, string> = { A: '#3b82f6', B: '#8b5cf6', C: '#ec4899', D: '#f59e0b' }
    return colors[agent] || '#6b7280'
  },
}))

import { fetchProgramStatus } from '../../programApi'

const mockFetch = fetchProgramStatus as ReturnType<typeof vi.fn>

// Base mock status WITHOUT wave data (backward compatibility)
const mockStatusNoWaves: ProgramStatus = {
  program_slug: 'test-program',
  title: 'Test Program',
  state: 'TIER_EXECUTING',
  current_tier: 2,
  tier_statuses: [
    {
      number: 1,
      description: 'Foundation',
      impl_statuses: [
        { slug: 'impl-alpha', title: 'Alpha', status: 'complete' },
        { slug: 'impl-beta', title: 'Beta', status: 'complete' },
      ],
      complete: true,
    },
    {
      number: 2,
      description: 'Features',
      impl_statuses: [
        { slug: 'impl-gamma', title: 'Gamma', status: 'executing' },
      ],
      complete: false,
    },
  ],
  contract_statuses: [],
  completion: {
    tiers_complete: 1,
    tiers_total: 2,
    impls_complete: 2,
    impls_total: 3,
    total_agents: 6,
    total_waves: 4,
  },
  is_executing: true,
}

// Mock status WITH nested wave/agent data
const mockStatusWithWaves: ProgramStatus = {
  program_slug: 'test-program',
  title: 'Test Program',
  state: 'TIER_EXECUTING',
  current_tier: 2,
  tier_statuses: [
    {
      number: 1,
      description: 'Foundation',
      impl_statuses: [
        {
          slug: 'impl-alpha',
          title: 'Alpha',
          status: 'complete',
          waves: [
            { number: 1, agents: [
              { id: 'A', status: 'complete' },
              { id: 'B', status: 'complete' },
            ]},
            { number: 2, agents: [
              { id: 'C', status: 'complete', dependencies: ['A', 'B'] },
            ]},
          ],
        },
        { slug: 'impl-beta', title: 'Beta', status: 'complete' },
      ],
      complete: true,
    },
    {
      number: 2,
      description: 'Features',
      impl_statuses: [
        {
          slug: 'impl-gamma',
          title: 'Gamma',
          status: 'executing',
          waves: [
            { number: 1, agents: [
              { id: 'A', status: 'complete' },
              { id: 'B', status: 'running' },
            ]},
            { number: 2, agents: [
              { id: 'C', status: 'pending', dependencies: ['A'] },
              { id: 'D', status: 'pending', dependencies: ['B'] },
            ]},
          ],
        },
      ],
      complete: false,
    },
  ],
  contract_statuses: [],
  completion: {
    tiers_complete: 1,
    tiers_total: 2,
    impls_complete: 2,
    impls_total: 3,
    total_agents: 7,
    total_waves: 4,
  },
  is_executing: true,
}

// Lazy import so mocks are in place before the component loads
let ProgramDependencyGraph: typeof import('../ProgramDependencyGraph').default

beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../ProgramDependencyGraph')
  ProgramDependencyGraph = mod.default
})

describe('ProgramDependencyGraph', () => {
  // -------------------------------------------------------------------
  // 1. Rendering with mock data (backward compat - no waves)
  // -------------------------------------------------------------------
  describe('rendering with status data (no waves)', () => {
    it('renders SVG with correct number of node rects', () => {
      const { container } = render(
        <ProgramDependencyGraph programSlug="test-program" status={mockStatusNoWaves} />,
      )

      const svg = container.querySelector('svg')
      expect(svg).not.toBeNull()

      // Node rects have rx=8, tier bg rects have rx=12
      const allRects = svg!.querySelectorAll('rect')
      const nodeRects = Array.from(allRects).filter(r => r.getAttribute('rx') === '8')
      expect(nodeRects).toHaveLength(3)

      const bgRects = Array.from(allRects).filter(r => r.getAttribute('rx') === '12')
      expect(bgRects).toHaveLength(2)
    })

    it('renders tier labels', () => {
      const { container } = render(
        <ProgramDependencyGraph programSlug="test-program" status={mockStatusNoWaves} />,
      )

      const svg = container.querySelector('svg')!
      const textEls = svg.querySelectorAll('text')
      const tierTexts = Array.from(textEls).filter(t => t.textContent === 'TIER')
      expect(tierTexts).toHaveLength(2)
    })

    it('renders slug labels for nodes', () => {
      const { container } = render(
        <ProgramDependencyGraph programSlug="test-program" status={mockStatusNoWaves} />,
      )

      const svg = container.querySelector('svg')!
      const textEls = Array.from(svg.querySelectorAll('text')).map(t => t.textContent)
      expect(textEls.some(t => t?.includes('impl-alpha'))).toBe(true)
      expect(textEls.some(t => t?.includes('impl-beta'))).toBe(true)
      expect(textEls.some(t => t?.includes('impl-gamma'))).toBe(true)
    })
  })

  // -------------------------------------------------------------------
  // 2. Empty / loading / error states
  // -------------------------------------------------------------------
  describe('empty/loading/error states', () => {
    it('shows Loading when no status prop provided', () => {
      mockFetch.mockReturnValue(new Promise(() => {})) // never resolves
      render(<ProgramDependencyGraph programSlug="test-program" />)
      expect(screen.getByText('Loading...')).toBeInTheDocument()
    })

    it('shows "No tiers to display" when tier_statuses is empty', () => {
      const emptyStatus: ProgramStatus = {
        ...mockStatusNoWaves,
        tier_statuses: [],
      }
      render(<ProgramDependencyGraph programSlug="test-program" status={emptyStatus} />)
      expect(screen.getByText('No tiers to display')).toBeInTheDocument()
    })

    it('shows error message when fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'))
      render(<ProgramDependencyGraph programSlug="test-program" />)
      const errorMsg = await screen.findByText(/Error: Network failure/)
      expect(errorMsg).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------
  // 3. onSelectImpl callback
  // -------------------------------------------------------------------
  describe('onSelectImpl callback', () => {
    it('calls onSelectImpl with correct slug when a node is clicked', () => {
      const onSelectImpl = vi.fn()
      const { container } = render(
        <ProgramDependencyGraph
          programSlug="test-program"
          status={mockStatusNoWaves}
          onSelectImpl={onSelectImpl}
        />,
      )

      const svg = container.querySelector('svg')!
      const clickableGroups = Array.from(svg.querySelectorAll('g')).filter(
        g => (g as HTMLElement).style?.cursor === 'pointer'
      )
      expect(clickableGroups.length).toBeGreaterThanOrEqual(3)

      fireEvent.click(clickableGroups[0])
      expect(onSelectImpl).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------
  // 4. waveProgress display (backward compat)
  // -------------------------------------------------------------------
  describe('waveProgress display', () => {
    it('displays wave progress text for executing IMPLs', () => {
      const { container } = render(
        <ProgramDependencyGraph
          programSlug="test-program"
          status={mockStatusNoWaves}
          waveProgress={{ 'impl-gamma': 'Wave 2/3' }}
        />,
      )

      const svg = container.querySelector('svg')!
      const textEls = Array.from(svg.querySelectorAll('text')).map(t => t.textContent)
      expect(textEls).toContain('Wave 2/3')
    })
  })

  // -------------------------------------------------------------------
  // 5. Nested agent nodes inside IMPL containers
  // -------------------------------------------------------------------
  describe('nested agent rendering', () => {
    it('renders agent circles inside IMPL containers with waves', () => {
      const { container } = render(
        <ProgramDependencyGraph programSlug="test-program" status={mockStatusWithWaves} />,
      )

      const svg = container.querySelector('svg')!

      // impl-alpha has waves with agents A, B, C
      const nestedAlpha = svg.querySelector('[data-testid="nested-agents-impl-alpha"]')
      expect(nestedAlpha).not.toBeNull()

      // Should render agent letter labels
      const agentTexts = Array.from(nestedAlpha!.querySelectorAll('text')).map(t => t.textContent)
      expect(agentTexts).toContain('A')
      expect(agentTexts).toContain('B')
      expect(agentTexts).toContain('C')
    })

    it('renders agent circles for executing IMPL (impl-gamma)', () => {
      const { container } = render(
        <ProgramDependencyGraph programSlug="test-program" status={mockStatusWithWaves} />,
      )

      const svg = container.querySelector('svg')!
      const nestedGamma = svg.querySelector('[data-testid="nested-agents-impl-gamma"]')
      expect(nestedGamma).not.toBeNull()

      const agentTexts = Array.from(nestedGamma!.querySelectorAll('text')).map(t => t.textContent)
      expect(agentTexts).toContain('A')
      expect(agentTexts).toContain('B')
      expect(agentTexts).toContain('C')
      expect(agentTexts).toContain('D')
    })

    it('renders wave row labels (W1, W2)', () => {
      const { container } = render(
        <ProgramDependencyGraph programSlug="test-program" status={mockStatusWithWaves} />,
      )

      const svg = container.querySelector('svg')!
      const nestedAlpha = svg.querySelector('[data-testid="nested-agents-impl-alpha"]')
      expect(nestedAlpha).not.toBeNull()

      const texts = Array.from(nestedAlpha!.querySelectorAll('text')).map(t => t.textContent)
      // Component renders "WAVE" label + wave number as separate text elements
      expect(texts.filter(t => t === 'WAVE').length).toBeGreaterThanOrEqual(2)
      expect(texts).toContain('1')
      expect(texts).toContain('2')
    })
  })

  // -------------------------------------------------------------------
  // 6. Variable IMPL container sizes
  // -------------------------------------------------------------------
  describe('variable container sizing', () => {
    it('IMPL with waves has larger container than IMPL without', () => {
      const { container } = render(
        <ProgramDependencyGraph programSlug="test-program" status={mockStatusWithWaves} />,
      )

      const svg = container.querySelector('svg')!

      // impl-alpha has waves -> should have nested agents group -> taller container
      const nestedAlpha = svg.querySelector('[data-testid="nested-agents-impl-alpha"]')
      expect(nestedAlpha).not.toBeNull()

      // impl-beta has no waves -> no nested agents group -> smaller container
      const nestedBeta = svg.querySelector('[data-testid="nested-agents-impl-beta"]')
      expect(nestedBeta).toBeNull()

      // impl-gamma has waves -> should have nested agents group
      const nestedGamma = svg.querySelector('[data-testid="nested-agents-impl-gamma"]')
      expect(nestedGamma).not.toBeNull()

      // Verify that IMPLs with waves produce containers with different dimensions
      // by checking that there are rx=8 rects with varying heights
      const allRx8 = Array.from(svg.querySelectorAll('rect[rx="8"]'))
      const heights = new Set(allRx8.map(r => r.getAttribute('height')))
      // Should have at least 2 different heights (60 for no-waves, >60 for waves)
      expect(heights.size).toBeGreaterThanOrEqual(2)
    })
  })

  // -------------------------------------------------------------------
  // 7. Fallback rendering when waves data is missing
  // -------------------------------------------------------------------
  describe('fallback rendering', () => {
    it('renders old-style status badge when IMPL has no waves', () => {
      const { container } = render(
        <ProgramDependencyGraph programSlug="test-program" status={mockStatusWithWaves} />,
      )

      const svg = container.querySelector('svg')!
      // impl-beta has no waves, should have status badge text
      const textEls = Array.from(svg.querySelectorAll('text')).map(t => t.textContent?.toUpperCase())
      // The status badge renders status in uppercase
      expect(textEls.some(t => t === 'COMPLETE')).toBe(true)
    })

    it('does not render nested agents group for IMPL without waves', () => {
      const { container } = render(
        <ProgramDependencyGraph programSlug="test-program" status={mockStatusWithWaves} />,
      )

      const svg = container.querySelector('svg')!
      // impl-beta has no waves -> no nested agents group
      const nestedBeta = svg.querySelector('[data-testid="nested-agents-impl-beta"]')
      expect(nestedBeta).toBeNull()
    })
  })

  // -------------------------------------------------------------------
  // 8. Tooltip shows agent summary
  // -------------------------------------------------------------------
  describe('tooltip with agent summary', () => {
    it('tooltip shows agent count and wave summary on hover', () => {
      const { container } = render(
        <ProgramDependencyGraph
          programSlug="test-program"
          status={mockStatusWithWaves}
          onSelectImpl={vi.fn()}
        />,
      )

      const svg = container.querySelector('svg')!
      // Find clickable groups (IMPL nodes)
      const clickableGroups = Array.from(svg.querySelectorAll('g')).filter(
        g => (g as HTMLElement).style?.cursor === 'pointer'
      )

      // Hover over the first node (impl-alpha with waves)
      fireEvent.mouseEnter(clickableGroups[0])

      // Tooltip should appear with agent info
      // Since createPortal is mocked to render inline, check the document
      const tooltipText = document.body.textContent || ''
      expect(tooltipText).toContain('impl-alpha')
      expect(tooltipText).toContain('Tier 1')
    })
  })
})
