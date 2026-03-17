// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import QueuePanel from './QueuePanel'

// Mock the autonomyApi module
vi.mock('../autonomyApi', () => ({
  fetchQueue: vi.fn().mockResolvedValue([]),
  addQueueItem: vi.fn().mockResolvedValue({}),
  deleteQueueItem: vi.fn().mockResolvedValue(undefined),
}))

describe('QueuePanel', () => {
  test('renders empty state with add form', async () => {
    render(<QueuePanel />)
    
    // Should show loading initially, then empty state
    expect(screen.getByText(/Loading queue/i)).toBeInTheDocument()
    
    // Wait for loading to complete and empty state to appear
    const emptyMessage = await screen.findByText(/Queue is empty/i)
    expect(emptyMessage).toBeInTheDocument()
    
    // Should have Add Item button
    expect(screen.getByText(/Add Item/i)).toBeInTheDocument()
  })
})
