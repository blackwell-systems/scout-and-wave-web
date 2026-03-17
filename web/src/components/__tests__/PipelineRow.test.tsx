import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PipelineRow from '../PipelineRow'
import { PipelineEntry } from '../../types/autonomy'

describe('PipelineRow', () => {
  it('renders complete status correctly', () => {
    const entry: PipelineEntry = {
      slug: 'test-feature',
      title: 'Test Feature IMPL',
      status: 'complete',
      completed_at: '2024-01-15T10:30:00Z',
      elapsed_seconds: 125,
    }

    render(<PipelineRow entry={entry} onSelect={() => {}} />)

    // Should show checkmark icon (via CheckCircle component)
    expect(screen.getByText('Test Feature IMPL')).toBeInTheDocument()
    
    // Should show Review button for completed IMPLs
    expect(screen.getByText('Review')).toBeInTheDocument()
    
    // Should show completed timestamp
    expect(screen.getByText(/\d{1,2}:\d{2}:\d{2}/)).toBeInTheDocument()
  })

  it('renders queued status with position', () => {
    const entry: PipelineEntry = {
      slug: 'queued-feature',
      title: 'Queued Feature',
      status: 'queued',
      queue_position: 3,
    }

    render(<PipelineRow entry={entry} onSelect={() => {}} />)

    expect(screen.getByText('Queued Feature')).toBeInTheDocument()
    expect(screen.getByText('Position #3')).toBeInTheDocument()
    
    // Should show View button for queued items
    expect(screen.getByText('View')).toBeInTheDocument()
  })

  it('renders executing status with wave progress', () => {
    const entry: PipelineEntry = {
      slug: 'executing-feature',
      title: 'Executing Feature',
      status: 'executing',
      wave_progress: 'Wave 2/3',
      active_agent: 'Agent B',
    }

    render(<PipelineRow entry={entry} onSelect={() => {}} />)

    expect(screen.getByText('Executing Feature')).toBeInTheDocument()
    expect(screen.getByText(/Wave 2\/3.*Agent B/)).toBeInTheDocument()
    
    // Should show Live button for executing IMPLs
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  it('renders blocked status with reason', () => {
    const entry: PipelineEntry = {
      slug: 'blocked-feature',
      title: 'Blocked Feature',
      status: 'blocked',
      blocked_reason: 'Waiting for dependency',
    }

    render(<PipelineRow entry={entry} onSelect={() => {}} />)

    expect(screen.getByText('Blocked Feature')).toBeInTheDocument()
    expect(screen.getByText('Waiting for dependency')).toBeInTheDocument()
    
    // Should show View button for blocked items
    expect(screen.getByText('View')).toBeInTheDocument()
  })

  it('calls onSelect when clicked', () => {
    const entry: PipelineEntry = {
      slug: 'clickable-feature',
      title: 'Clickable Feature',
      status: 'complete',
    }

    let selectedSlug = ''
    render(<PipelineRow entry={entry} onSelect={(slug) => { selectedSlug = slug }} />)

    const row = screen.getByText('Clickable Feature').closest('div')
    if (row) {
      row.click()
      expect(selectedSlug).toBe('clickable-feature')
    }
  })
})
