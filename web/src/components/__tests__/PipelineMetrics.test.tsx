import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PipelineMetricsBar from '../PipelineMetrics'
import { PipelineMetrics } from '../../types/autonomy'

describe('PipelineMetrics', () => {
  it('renders all metric values', () => {
    const metrics: PipelineMetrics = {
      impls_per_hour: 2.5,
      avg_wave_seconds: 180,
      queue_depth: 5,
      blocked_count: 2,
      completed_count: 12,
    }

    render(<PipelineMetricsBar metrics={metrics} />)

    // IMPLs/hr
    expect(screen.getByText('IMPLs/hr:')).toBeInTheDocument()
    expect(screen.getByText('2.5')).toBeInTheDocument()

    // Avg Wave
    expect(screen.getByText('Avg Wave:')).toBeInTheDocument()
    expect(screen.getByText('180s')).toBeInTheDocument()

    // Queue depth
    expect(screen.getByText('Queue:')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()

    // Blocked count
    expect(screen.getByText('Blocked:')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    // Completed count
    expect(screen.getByText('Completed:')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('handles zero metrics', () => {
    const metrics: PipelineMetrics = {
      impls_per_hour: 0,
      avg_wave_seconds: 0,
      queue_depth: 0,
      blocked_count: 0,
      completed_count: 0,
    }

    render(<PipelineMetricsBar metrics={metrics} />)

    expect(screen.getByText('0.0')).toBeInTheDocument()
    expect(screen.getByText('0s')).toBeInTheDocument()
  })

  it('formats impls_per_hour to one decimal place', () => {
    const metrics: PipelineMetrics = {
      impls_per_hour: 1.666666,
      avg_wave_seconds: 0,
      queue_depth: 0,
      blocked_count: 0,
      completed_count: 0,
    }

    render(<PipelineMetricsBar metrics={metrics} />)

    // Should be formatted to 1.7
    expect(screen.getByText('1.7')).toBeInTheDocument()
  })
})
