import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RecoveryControlsPanel from '../RecoveryControlsPanel'

const ALL_STEPS = [
  'verify_commits',
  'scan_stubs',
  'run_gates',
  'validate_integration',
  'merge_agents',
  'fix_go_mod',
  'verify_build',
  'cleanup',
]

const STEP_LABELS: Record<string, string> = {
  verify_commits: 'Verify Commits',
  scan_stubs: 'Scan Stubs',
  run_gates: 'Run Gates',
  validate_integration: 'Validate Integration',
  merge_agents: 'Merge Agents',
  fix_go_mod: 'Fix Go Mod',
  verify_build: 'Verify Build',
  cleanup: 'Cleanup',
}

function makeSteps(overrides: Record<string, { status: string; error?: string }> = {}): Record<string, { status: string; error?: string }> {
  const steps: Record<string, { status: string; error?: string }> = {}
  for (const s of ALL_STEPS) {
    steps[s] = overrides[s] ?? { status: 'pending' }
  }
  return steps
}

const defaultProps = {
  slug: 'test-feature',
  wave: 1,
  onRetryStep: vi.fn().mockResolvedValue(undefined),
  onSkipStep: vi.fn().mockResolvedValue(undefined),
  onForceComplete: vi.fn().mockResolvedValue(undefined),
  onRetryFinalize: vi.fn().mockResolvedValue(undefined),
}

describe('RecoveryControlsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders all 8 steps in correct order', () => {
    const steps = makeSteps()
    render(<RecoveryControlsPanel {...defaultProps} pipelineSteps={steps} />)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(8)

    // Verify order by checking text content sequence
    for (let i = 0; i < ALL_STEPS.length; i++) {
      expect(items[i]).toHaveTextContent(STEP_LABELS[ALL_STEPS[i]])
    }
  })

  it('shows retry button for failed step', () => {
    const steps = makeSteps({
      scan_stubs: { status: 'failed', error: 'stub found in main.go' },
    })
    render(<RecoveryControlsPanel {...defaultProps} pipelineSteps={steps} />)

    const retryButtons = screen.getAllByText('Retry')
    expect(retryButtons.length).toBeGreaterThanOrEqual(1)

    // The error message should be shown
    expect(screen.getByText('stub found in main.go')).toBeInTheDocument()
  })

  it('shows skip button only for skippable failed steps', () => {
    // scan_stubs is skippable, verify_commits is not
    const steps = makeSteps({
      verify_commits: { status: 'failed', error: 'no commits' },
      scan_stubs: { status: 'failed', error: 'stub found' },
    })
    render(<RecoveryControlsPanel {...defaultProps} pipelineSteps={steps} />)

    // Both should have Retry buttons
    const retryButtons = screen.getAllByText('Retry')
    expect(retryButtons).toHaveLength(2)

    // Only scan_stubs should have Skip button
    const skipButtons = screen.getAllByText('Skip')
    expect(skipButtons).toHaveLength(1)
  })

  it('renders nothing when pipelineSteps is empty', () => {
    const { container } = render(
      <RecoveryControlsPanel {...defaultProps} pipelineSteps={{}} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('force complete button shows confirmation dialog before firing', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onForceComplete = vi.fn().mockResolvedValue(undefined)

    const steps = makeSteps({ verify_commits: { status: 'failed' } })
    render(
      <RecoveryControlsPanel
        {...defaultProps}
        pipelineSteps={steps}
        onForceComplete={onForceComplete}
      />
    )

    fireEvent.click(screen.getByText('Force Mark Complete'))

    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(() => {
      expect(onForceComplete).toHaveBeenCalled()
    })

    // Also test when user cancels
    confirmSpy.mockReturnValue(false)
    onForceComplete.mockClear()

    fireEvent.click(screen.getByText('Force Mark Complete'))
    expect(onForceComplete).not.toHaveBeenCalled()
  })

  it('shows "Already in progress" on 409 error', async () => {
    const onRetryStep = vi.fn().mockRejectedValue(new Error('409 Conflict'))

    const steps = makeSteps({
      scan_stubs: { status: 'failed', error: 'stub found' },
    })
    render(
      <RecoveryControlsPanel
        {...defaultProps}
        pipelineSteps={steps}
        onRetryStep={onRetryStep}
      />
    )

    fireEvent.click(screen.getByText('Retry'))

    await waitFor(() => {
      expect(screen.getByText('Already in progress')).toBeInTheDocument()
    })
  })
})
