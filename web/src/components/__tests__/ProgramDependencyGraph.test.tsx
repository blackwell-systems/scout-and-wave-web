// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
vi.mock('../../lib/agentColors', () => ({
  resetThemeCache: vi.fn(),
}))

import { fetchProgramStatus } from '../../programApi'

const mockFetch = fetchProgramStatus as ReturnType<typeof vi.fn>

const mockStatus: ProgramStatus = {
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

// Lazy import so mocks are in place before the component loads
let ProgramDependencyGraph: typeof import('../ProgramDependencyGraph').default

beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../ProgramDependencyGraph')
  ProgramDependencyGraph = mod.default
})

describe('ProgramDependencyGraph', () => {
  // -------------------------------------------------------------------
  // 1. Rendering with mock data
  // -------------------------------------------------------------------
  describe('rendering with status data', () => {
    it('renders SVG with correct number of node rects', () => {
      const { container } = render(
        <ProgramDependencyGraph programSlug="test-program" status={mockStatus} />,
      )

      // 3 IMPLs -> 3 node <rect> elements (plus tier background rects)
      // Each node group has one rect; tier backgrounds also have rects
      const svg = container.querySelector('svg')
      expect(svg).not.toBeNull()

      // Node rects have rx=8, tier bg rects have rx=12
      const allRects = svg!.querySelectorAll('rect')
      // 2 tier bg rects (rx=12) + 3 node rects (rx=8)
      const nodeRects = Array.from(allRects).filter(r => r.getAttribute('rx') === '8')
      expect(nodeRects).toHaveLength(3)

      const bgRects = Array.from(allRects).filter(r => r.getAttribute('rx') === '12')
      expect(bgRects).toHaveLength(2)
    })

    it('renders tier labels', () => {
      const { container } = render(
        <ProgramDependencyGraph programSlug="test-program" status={mockStatus} />,
      )

      const svg = container.querySelector('svg')!
      const textEls = svg.querySelectorAll('text')
      const tierTexts = Array.from(textEls).filter(t => t.textContent === 'TIER')
      // 2 tiers -> 2 "TIER" labels
      expect(tierTexts).toHaveLength(2)
    })

    it('renders abbreviated labels for nodes', () => {
      const { container } = render(
        <ProgramDependencyGraph programSlug="test-program" status={mockStatus} />,
      )

      const svg = container.querySelector('svg')!
      const textEls = Array.from(svg.querySelectorAll('text')).map(t => t.textContent)
      // impl-alpha -> IA, impl-beta -> IB, impl-gamma -> IG
      expect(textEls).toContain('IA')
      expect(textEls).toContain('IB')
      expect(textEls).toContain('IG')
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
        ...mockStatus,
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
          status={mockStatus}
          onSelectImpl={onSelectImpl}
        />,
      )

      // Node groups are <g> elements with class "cursor-pointer"
      const svg = container.querySelector('svg')!
      const nodeGroups = svg.querySelectorAll('g.cursor-pointer')
      expect(nodeGroups.length).toBeGreaterThanOrEqual(3)

      // Click the first node group (impl-alpha)
      fireEvent.click(nodeGroups[0])
      expect(onSelectImpl).toHaveBeenCalledWith('impl-alpha')
    })
  })

  // -------------------------------------------------------------------
  // 4. waveProgress display
  // -------------------------------------------------------------------
  describe('waveProgress display', () => {
    it('displays wave progress text for executing IMPLs', () => {
      const { container } = render(
        <ProgramDependencyGraph
          programSlug="test-program"
          status={mockStatus}
          waveProgress={{ 'impl-gamma': 'Wave 2/3' }}
        />,
      )

      const svg = container.querySelector('svg')!
      const textEls = Array.from(svg.querySelectorAll('text')).map(t => t.textContent)
      expect(textEls).toContain('Wave 2/3')
    })
  })
})
