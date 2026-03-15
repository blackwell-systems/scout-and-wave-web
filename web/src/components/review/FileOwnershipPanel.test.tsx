// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'

// ─── Hoist mocks ──────────────────────────────────────────────────────────────

const { mockFileModal } = vi.hoisted(() => {
  const mockFileModal = vi.fn(({ repo, initialFile, onClose }: {
    repo: string
    initialFile?: string
    onClose: () => void
  }) => (
    <div data-testid="file-modal" data-repo={repo} data-initial-file={initialFile ?? ''}>
      <button data-testid="modal-close" onClick={onClose}>Close</button>
    </div>
  ))
  return { mockFileModal }
})

vi.mock('../FileBrowser/FileModal', () => ({
  default: mockFileModal,
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import FileOwnershipPanel from './FileOwnershipPanel'
import { IMPLDocResponse, RepoEntry } from '../../types'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeImpl(overrides: Partial<IMPLDocResponse['file_ownership'][0]>[] = []): IMPLDocResponse {
  const defaultEntries = [
    { file: 'web/src/components/Foo.tsx', agent: 'A', wave: 1, action: 'new', depends_on: '' },
    { file: 'web/src/components/Bar.tsx', agent: 'B', wave: 2, action: 'modify', depends_on: '' },
    { file: 'web/src/components/Old.tsx', agent: 'C', wave: 1, action: 'delete', depends_on: '' },
  ]

  const entries = defaultEntries.map((e, i) => ({ ...e, ...(overrides[i] ?? {}) }))

  return {
    title: 'Test IMPL',
    slug: 'test',
    date: '2024-01-01',
    status: 'draft',
    file_ownership: entries,
    file_ownership_col4_name: 'Action',
    waves: [],
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

const sampleRepos: RepoEntry[] = [
  { name: 'web', path: '/project/web' },
  { name: 'api', path: '/project/api' },
]

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FileOwnershipPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── 1. Shows view file buttons ────────────────────────────────────────────

  test('FileOwnershipPanel shows view file buttons', () => {
    const impl = makeImpl()
    render(<FileOwnershipPanel impl={impl} repos={sampleRepos} />)

    const viewButtons = screen.getAllByTestId('view-file-btn')
    // Should show buttons for non-deleted files (2 out of 3: Foo.tsx and Bar.tsx)
    expect(viewButtons).toHaveLength(2)
  })

  test('FileOwnershipPanel does not show view button for deleted files', () => {
    const impl = makeImpl()
    render(<FileOwnershipPanel impl={impl} repos={sampleRepos} />)

    const viewButtons = screen.getAllByTestId('view-file-btn')
    // 3 entries: 2 non-delete, 1 delete — only 2 buttons
    expect(viewButtons).toHaveLength(2)
  })

  test('FileOwnershipPanel view buttons have correct aria-label', () => {
    const impl = makeImpl()
    render(<FileOwnershipPanel impl={impl} repos={sampleRepos} />)

    expect(screen.getByLabelText('View file web/src/components/Foo.tsx')).toBeInTheDocument()
    expect(screen.getByLabelText('View file web/src/components/Bar.tsx')).toBeInTheDocument()
  })

  // ── 2. Opens modal on button click ────────────────────────────────────────

  test('FileOwnershipPanel opens modal on button click', () => {
    const impl = makeImpl()
    render(<FileOwnershipPanel impl={impl} repos={sampleRepos} />)

    // Modal should not be present initially
    expect(screen.queryByTestId('file-modal')).not.toBeInTheDocument()

    // Click the first view button (Foo.tsx)
    const viewButtons = screen.getAllByTestId('view-file-btn')
    fireEvent.click(viewButtons[0])

    // Modal should now be open
    expect(screen.getByTestId('file-modal')).toBeInTheDocument()
  })

  test('FileOwnershipPanel passes correct initialFile to modal', () => {
    const impl = makeImpl()
    render(<FileOwnershipPanel impl={impl} repos={sampleRepos} />)

    const viewButtons = screen.getAllByTestId('view-file-btn')
    fireEvent.click(viewButtons[0])

    const modal = screen.getByTestId('file-modal')
    expect(modal).toHaveAttribute('data-initial-file', 'web/src/components/Foo.tsx')
  })

  test('FileOwnershipPanel uses first repo when entry has no repo field', () => {
    const impl = makeImpl()
    render(<FileOwnershipPanel impl={impl} repos={sampleRepos} />)

    const viewButtons = screen.getAllByTestId('view-file-btn')
    fireEvent.click(viewButtons[0])

    const modal = screen.getByTestId('file-modal')
    // No repo field on entry → uses first repo from repos array
    expect(modal).toHaveAttribute('data-repo', 'web')
  })

  test('FileOwnershipPanel uses entry repo field when present', () => {
    const impl = makeImpl()
    // Override first entry with a repo field
    impl.file_ownership[0].repo = 'api'

    render(<FileOwnershipPanel impl={impl} repos={sampleRepos} />)

    const viewButtons = screen.getAllByTestId('view-file-btn')
    fireEvent.click(viewButtons[0])

    const modal = screen.getByTestId('file-modal')
    expect(modal).toHaveAttribute('data-repo', 'api')
  })

  test('FileOwnershipPanel closes modal when onClose is called', () => {
    const impl = makeImpl()
    render(<FileOwnershipPanel impl={impl} repos={sampleRepos} />)

    // Open the modal
    const viewButtons = screen.getAllByTestId('view-file-btn')
    fireEvent.click(viewButtons[0])
    expect(screen.getByTestId('file-modal')).toBeInTheDocument()

    // Close the modal
    fireEvent.click(screen.getByTestId('modal-close'))
    expect(screen.queryByTestId('file-modal')).not.toBeInTheDocument()
  })

  test('FileOwnershipPanel does not open modal when no repos provided', () => {
    const impl = makeImpl()
    // No repos provided and no repo field on entries → modal won't open
    render(<FileOwnershipPanel impl={impl} repos={[]} />)

    const viewButtons = screen.getAllByTestId('view-file-btn')
    fireEvent.click(viewButtons[0])

    // Modal should NOT appear because repo is empty string
    expect(screen.queryByTestId('file-modal')).not.toBeInTheDocument()
  })
})
