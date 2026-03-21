// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ValidationPanel from '../ValidationPanel'
import type { ValidateIntegrationResponse, ValidateWiringResponse } from '../ValidationPanel'

// Mock sawClient so we can control the API responses
vi.mock('../../lib/apiClient', () => ({
  sawClient: {
    impl: {
      validateIntegration: vi.fn(),
      validateWiring: vi.fn(),
    },
  },
}))

// Import the mock after vi.mock is set up
import { sawClient } from '../../lib/apiClient'
const mockImpl = sawClient.impl as any

describe('ValidationPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockImpl.validateIntegration = vi.fn()
    mockImpl.validateWiring = vi.fn()
  })

  // ─── Rendering tests ────────────────────────────────────────────────────────

  it('renders Validate Wiring button always', () => {
    render(<ValidationPanel slug="test-feature" />)
    expect(screen.getByTestId('validate-wiring-btn')).toBeInTheDocument()
  })

  it('does not render Validate Integration button when currentWave is undefined', () => {
    render(<ValidationPanel slug="test-feature" />)
    expect(screen.queryByTestId('validate-integration-btn')).not.toBeInTheDocument()
  })

  it('renders Validate Integration button when currentWave is defined', () => {
    render(<ValidationPanel slug="test-feature" currentWave={2} />)
    expect(screen.getByTestId('validate-integration-btn')).toBeInTheDocument()
    expect(screen.getByTestId('validate-integration-btn')).toHaveTextContent('Validate Integration (Wave 2)')
  })

  // ─── API call tests ─────────────────────────────────────────────────────────

  it('calls validateWiring with correct slug on button click', async () => {
    const response: ValidateWiringResponse = { valid: true, gaps: [] }
    mockImpl.validateWiring.mockResolvedValue(response)

    render(<ValidationPanel slug="my-feature" />)
    fireEvent.click(screen.getByTestId('validate-wiring-btn'))

    await waitFor(() => {
      expect(mockImpl.validateWiring).toHaveBeenCalledWith('my-feature')
    })
  })

  it('calls validateIntegration with slug and wave on button click', async () => {
    const response: ValidateIntegrationResponse = { valid: true, wave: 3, gaps: [] }
    mockImpl.validateIntegration.mockResolvedValue(response)

    render(<ValidationPanel slug="my-feature" currentWave={3} />)
    fireEvent.click(screen.getByTestId('validate-integration-btn'))

    await waitFor(() => {
      expect(mockImpl.validateIntegration).toHaveBeenCalledWith('my-feature', 3)
    })
  })

  // ─── Loading state tests ────────────────────────────────────────────────────

  it('shows spinner while validation is in progress', async () => {
    // Never resolves during the test
    mockImpl.validateWiring.mockReturnValue(new Promise(() => {}))

    render(<ValidationPanel slug="test-feature" />)
    fireEvent.click(screen.getByTestId('validate-wiring-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('spinner')).toBeInTheDocument()
    })
  })

  it('disables buttons while validating', async () => {
    mockImpl.validateWiring.mockReturnValue(new Promise(() => {}))

    render(<ValidationPanel slug="test-feature" currentWave={1} />)
    fireEvent.click(screen.getByTestId('validate-wiring-btn'))

    await waitFor(() => {
      expect(screen.getByTestId('validate-wiring-btn')).toBeDisabled()
      expect(screen.getByTestId('validate-integration-btn')).toBeDisabled()
    })
  })

  // ─── Result display tests ───────────────────────────────────────────────────

  it('displays valid result with no gaps for wiring validation', async () => {
    const response: ValidateWiringResponse = { valid: true, gaps: [] }
    mockImpl.validateWiring.mockResolvedValue(response)

    render(<ValidationPanel slug="test-feature" />)
    fireEvent.click(screen.getByTestId('validate-wiring-btn'))

    await waitFor(() => {
      expect(screen.getByText('Wiring: Valid')).toBeInTheDocument()
    })
  })

  it('displays invalid result with gaps for wiring validation', async () => {
    const response: ValidateWiringResponse = {
      valid: false,
      gaps: [
        {
          file: 'pkg/api/handler.go',
          line: 42,
          reason: 'Missing call to RegisterRoutes',
          type: 'semantic',
          severity: 'high',
        },
        {
          file: 'web/src/App.tsx',
          reason: 'Unconnected component prop',
          severity: 'medium',
        },
      ],
    }
    mockImpl.validateWiring.mockResolvedValue(response)

    render(<ValidationPanel slug="test-feature" />)
    fireEvent.click(screen.getByTestId('validate-wiring-btn'))

    await waitFor(() => {
      expect(screen.getByText('Wiring: 2 gaps found')).toBeInTheDocument()
      expect(screen.getByText('pkg/api/handler.go:42')).toBeInTheDocument()
      expect(screen.getByText('Missing call to RegisterRoutes')).toBeInTheDocument()
      expect(screen.getByText('web/src/App.tsx')).toBeInTheDocument()
      expect(screen.getByText('Unconnected component prop')).toBeInTheDocument()
    })
  })

  it('displays integration gaps with severity badges', async () => {
    const response: ValidateIntegrationResponse = {
      valid: false,
      wave: 2,
      gaps: [
        {
          file: 'pkg/engine/runner.go',
          reason: 'Interface not implemented',
          severity: 'high',
          type: 'syntax',
        },
      ],
    }
    mockImpl.validateIntegration.mockResolvedValue(response)

    render(<ValidationPanel slug="test-feature" currentWave={2} />)
    fireEvent.click(screen.getByTestId('validate-integration-btn'))

    await waitFor(() => {
      expect(screen.getByText('Integration (Wave 2): 1 gap found')).toBeInTheDocument()
      expect(screen.getByText('pkg/engine/runner.go')).toBeInTheDocument()
      expect(screen.getByText('Interface not implemented')).toBeInTheDocument()
      expect(screen.getByText('high')).toBeInTheDocument()
      expect(screen.getByText('syntax')).toBeInTheDocument()
    })
  })

  it('shows "No gaps found" when validation passes with empty gaps', async () => {
    const response: ValidateWiringResponse = { valid: false, gaps: [] }
    mockImpl.validateWiring.mockResolvedValue(response)

    render(<ValidationPanel slug="test-feature" />)
    fireEvent.click(screen.getByTestId('validate-wiring-btn'))

    await waitFor(() => {
      expect(screen.getByText('No gaps found')).toBeInTheDocument()
    })
  })

  // ─── Error handling tests ───────────────────────────────────────────────────

  it('displays error message when API call fails', async () => {
    mockImpl.validateWiring.mockRejectedValue(new Error('Network error: connection refused'))

    render(<ValidationPanel slug="test-feature" />)
    fireEvent.click(screen.getByTestId('validate-wiring-btn'))

    await waitFor(() => {
      expect(screen.getByText('Network error: connection refused')).toBeInTheDocument()
    })
  })
})
