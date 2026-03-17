// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import AutonomySettings from './AutonomySettings'

// Mock the autonomyApi module
vi.mock('../autonomyApi', () => ({
  fetchAutonomy: vi.fn().mockResolvedValue({
    level: 'gated',
    max_auto_retries: 3,
    max_queue_depth: 10,
  }),
  saveAutonomy: vi.fn().mockResolvedValue(undefined),
}))

describe('AutonomySettings', () => {
  test('renders all three level options', async () => {
    render(<AutonomySettings />)
    
    // Wait for loading to complete
    const select = await screen.findByLabelText(/Execution Mode/i)
    expect(select).toBeInTheDocument()
    
    // Should have all three options
    const gatedOption = screen.getByRole('option', { name: /Gated/i })
    const supervisedOption = screen.getByRole('option', { name: /Supervised/i })
    const autonomousOption = screen.getByRole('option', { name: /Autonomous/i })
    
    expect(gatedOption).toBeInTheDocument()
    expect(supervisedOption).toBeInTheDocument()
    expect(autonomousOption).toBeInTheDocument()
  })
})
