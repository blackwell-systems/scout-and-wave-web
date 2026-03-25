import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ImportPanel from '../ImportPanel'

// Mock sawClient so we don't make real HTTP requests.
vi.mock('../../lib/apiClient', () => ({
  sawClient: {
    impl: {
      importImpls: vi.fn(),
    },
  },
}))

import { sawClient } from '../../lib/apiClient'

const mockImportImpls = (sawClient.impl as any).importImpls as ReturnType<typeof vi.fn>

describe('ImportPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockImportImpls.mockReset()
  })

  it('renders form inputs correctly', () => {
    render(<ImportPanel />)

    expect(screen.getByLabelText('Program slug')).toBeInTheDocument()
    expect(screen.getByLabelText('IMPL paths (one per line)')).toBeInTheDocument()
    expect(
      screen.getByLabelText('Auto-discover plans from docs/IMPL/'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Import IMPLs/i }),
    ).toBeInTheDocument()
  })

  it('discover mode disables manual paths textarea', () => {
    render(<ImportPanel />)

    const textarea = screen.getByLabelText('IMPL paths (one per line)')
    const checkbox = screen.getByLabelText('Auto-discover plans from docs/IMPL/')

    // Initially textarea is enabled
    expect(textarea).not.toBeDisabled()

    // Enable discover mode
    fireEvent.click(checkbox)
    expect(textarea).toBeDisabled()

    // Disable discover mode
    fireEvent.click(checkbox)
    expect(textarea).not.toBeDisabled()
  })

  it('import button calls sawClient.impl.importImpls with correct payload', async () => {
    mockImportImpls.mockResolvedValue({
      program_path: '/path/to/PROGRAM-test.yaml',
      imported: ['feature-a', 'feature-b'],
      skipped: [],
    })

    render(<ImportPanel />)

    // Fill in program slug
    const slugInput = screen.getByLabelText('Program slug')
    fireEvent.change(slugInput, { target: { value: 'my-program' } })

    // Add manual paths
    const textarea = screen.getByLabelText('IMPL paths (one per line)')
    fireEvent.change(textarea, {
      target: { value: 'docs/IMPL/IMPL-feature-a.yaml\ndocs/IMPL/IMPL-feature-b.yaml' },
    })

    // Click import
    fireEvent.click(screen.getByRole('button', { name: /Import IMPLs/i }))

    await waitFor(() => {
      expect(mockImportImpls).toHaveBeenCalledWith({
        program_slug: 'my-program',
        impl_paths: ['docs/IMPL/IMPL-feature-a.yaml', 'docs/IMPL/IMPL-feature-b.yaml'],
        tier_map: {},
        discover: false,
      })
    })
  })

  it('calls importImpls with discover=true when discover mode is enabled', async () => {
    mockImportImpls.mockResolvedValue({
      program_path: '/path/to/PROGRAM-test.yaml',
      imported: [],
      skipped: [],
    })

    render(<ImportPanel />)

    const slugInput = screen.getByLabelText('Program slug')
    fireEvent.change(slugInput, { target: { value: 'discover-program' } })

    const checkbox = screen.getByLabelText('Auto-discover plans from docs/IMPL/')
    fireEvent.click(checkbox)

    fireEvent.click(screen.getByRole('button', { name: /Import IMPLs/i }))

    await waitFor(() => {
      expect(mockImportImpls).toHaveBeenCalledWith(
        expect.objectContaining({
          program_slug: 'discover-program',
          discover: true,
          impl_paths: [],
        }),
      )
    })
  })

  it('result panel displays imported and skipped counts', async () => {
    mockImportImpls.mockResolvedValue({
      program_path: '/path/to/PROGRAM-test.yaml',
      imported: ['feature-a', 'feature-b'],
      skipped: ['feature-c'],
    })

    render(<ImportPanel />)

    const slugInput = screen.getByLabelText('Program slug')
    fireEvent.change(slugInput, { target: { value: 'my-program' } })

    fireEvent.click(screen.getByRole('button', { name: /Import IMPLs/i }))

    await waitFor(() => {
      // Count badges
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('1')).toBeInTheDocument()

      // Labels
      expect(screen.getByText('Imported')).toBeInTheDocument()
      expect(screen.getByText('Skipped (already present)')).toBeInTheDocument()

      // Slug list
      expect(screen.getByText('+ feature-a')).toBeInTheDocument()
      expect(screen.getByText('+ feature-b')).toBeInTheDocument()
      expect(screen.getByText('= feature-c')).toBeInTheDocument()

      // Program path
      expect(screen.getByText('/path/to/PROGRAM-test.yaml')).toBeInTheDocument()
    })
  })

  it('shows error message when import fails', async () => {
    mockImportImpls.mockRejectedValue(new Error('HTTP 500: internal server error'))

    render(<ImportPanel />)

    const slugInput = screen.getByLabelText('Program slug')
    fireEvent.change(slugInput, { target: { value: 'my-program' } })

    fireEvent.click(screen.getByRole('button', { name: /Import IMPLs/i }))

    await waitFor(() => {
      expect(screen.getByText('HTTP 500: internal server error')).toBeInTheDocument()
    })
  })

  it('import button is disabled when program slug is empty', () => {
    render(<ImportPanel />)

    const button = screen.getByRole('button', { name: /Import IMPLs/i })
    expect(button).toBeDisabled()

    const slugInput = screen.getByLabelText('Program slug')
    fireEvent.change(slugInput, { target: { value: 'some-slug' } })
    expect(button).not.toBeDisabled()
  })

  it('tier dropdowns default to tier 1 for manual paths', () => {
    render(<ImportPanel />)

    const slugInput = screen.getByLabelText('Program slug')
    fireEvent.change(slugInput, { target: { value: 'my-program' } })

    const textarea = screen.getByLabelText('IMPL paths (one per line)')
    fireEvent.change(textarea, {
      target: { value: 'docs/IMPL/IMPL-feature-a.yaml' },
    })

    const tierSelect = screen.getByLabelText(
      'Tier for docs/IMPL/IMPL-feature-a.yaml',
    )
    expect(tierSelect).toBeInTheDocument()
    expect((tierSelect as HTMLSelectElement).value).toBe('1')
  })

  it('includes tier_map in request when tiers are changed', async () => {
    mockImportImpls.mockResolvedValue({
      program_path: '/path/to/PROGRAM-test.yaml',
      imported: ['feature-a'],
      skipped: [],
    })

    render(<ImportPanel />)

    const slugInput = screen.getByLabelText('Program slug')
    fireEvent.change(slugInput, { target: { value: 'my-program' } })

    const textarea = screen.getByLabelText('IMPL paths (one per line)')
    fireEvent.change(textarea, { target: { value: 'feature-a' } })

    // Change tier to 3
    const tierSelect = screen.getByLabelText('Tier for feature-a')
    fireEvent.change(tierSelect, { target: { value: '3' } })

    fireEvent.click(screen.getByRole('button', { name: /Import IMPLs/i }))

    await waitFor(() => {
      expect(mockImportImpls).toHaveBeenCalledWith(
        expect.objectContaining({
          tier_map: { 'feature-a': 3 },
        }),
      )
    })
  })
})
