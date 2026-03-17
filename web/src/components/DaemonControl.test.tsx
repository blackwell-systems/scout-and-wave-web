// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import DaemonControl from './DaemonControl'

// Mock the autonomyApi module
vi.mock('../autonomyApi', () => ({
  fetchDaemonStatus: vi.fn().mockResolvedValue({
    running: false,
    queue_depth: 0,
    completed_count: 0,
    blocked_count: 0,
  }),
  subscribeDaemonEvents: vi.fn().mockReturnValue({
    addEventListener: vi.fn(),
    close: vi.fn(),
  }),
  startDaemon: vi.fn().mockResolvedValue({
    running: true,
    queue_depth: 0,
    completed_count: 0,
    blocked_count: 0,
  }),
  stopDaemon: vi.fn().mockResolvedValue(undefined),
}))

describe('DaemonControl', () => {
  test('shows Start when not running', async () => {
    render(<DaemonControl />)
    
    // Wait for loading to complete
    const startButton = await screen.findByText(/Start/i)
    expect(startButton).toBeInTheDocument()
    
    // Should show Stopped status
    expect(screen.getByText(/Stopped/i)).toBeInTheDocument()
  })
})
