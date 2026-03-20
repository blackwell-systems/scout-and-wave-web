import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import { AgentStatusBadge, WaveStatusBadge, ImplStatusBadge } from './StatusBadges'

describe('AgentStatusBadge', () => {
  test.each(['pending', 'running', 'complete', 'failed'])('renders %s status', (status) => {
    render(<AgentStatusBadge status={status} />)
    const badge = screen.getByTestId(`agent-status-badge-${status}`)
    expect(badge).toBeDefined()
    expect(badge.textContent).toBeTruthy()
  })

  test('renders sm size', () => {
    render(<AgentStatusBadge status="running" size="sm" />)
    const badge = screen.getByTestId('agent-status-badge-running')
    expect(badge.className).toContain('text-[10px]')
  })

  test('renders md size by default', () => {
    render(<AgentStatusBadge status="complete" />)
    const badge = screen.getByTestId('agent-status-badge-complete')
    expect(badge.className).toContain('text-xs')
  })

  test('applies custom className', () => {
    render(<AgentStatusBadge status="pending" className="my-custom" />)
    const badge = screen.getByTestId('agent-status-badge-pending')
    expect(badge.className).toContain('my-custom')
  })

  test('falls back to pending for unknown status', () => {
    render(<AgentStatusBadge status="unknown-status" />)
    const badge = screen.getByTestId('agent-status-badge-unknown-status')
    expect(badge.textContent).toBe('Pending')
  })

  test('running status has animate-pulse', () => {
    render(<AgentStatusBadge status="running" />)
    const badge = screen.getByTestId('agent-status-badge-running')
    expect(badge.className).toContain('animate-pulse')
  })
})

describe('WaveStatusBadge', () => {
  test.each(['pending', 'running', 'complete', 'partial', 'merged', 'failed'])('renders %s status', (status) => {
    render(<WaveStatusBadge status={status} />)
    const badge = screen.getByTestId(`wave-status-badge-${status}`)
    expect(badge).toBeDefined()
    expect(badge.textContent).toBeTruthy()
  })

  test('renders sm size', () => {
    render(<WaveStatusBadge status="merged" size="sm" />)
    const badge = screen.getByTestId('wave-status-badge-merged')
    expect(badge.className).toContain('text-[10px]')
  })

  test('partial status shows yellow styling', () => {
    render(<WaveStatusBadge status="partial" />)
    const badge = screen.getByTestId('wave-status-badge-partial')
    expect(badge.className).toContain('bg-yellow-100')
  })

  test('falls back to pending for unknown status', () => {
    render(<WaveStatusBadge status="nope" />)
    const badge = screen.getByTestId('wave-status-badge-nope')
    expect(badge.textContent).toBe('Pending')
  })
})

describe('ImplStatusBadge', () => {
  test.each(['complete', 'executing', 'in-progress', 'reviewed', 'scouting', 'blocked', 'not-suitable', 'pending'])(
    'renders %s status',
    (status) => {
      render(<ImplStatusBadge status={status} />)
      const badge = screen.getByTestId(`impl-status-badge-${status}`)
      expect(badge).toBeDefined()
      expect(badge.textContent).toBeTruthy()
    },
  )

  test('executing has animate-pulse', () => {
    render(<ImplStatusBadge status="executing" />)
    const badge = screen.getByTestId('impl-status-badge-executing')
    expect(badge.className).toContain('animate-pulse')
  })

  test('scouting has purple styling', () => {
    render(<ImplStatusBadge status="scouting" />)
    const badge = screen.getByTestId('impl-status-badge-scouting')
    expect(badge.className).toContain('bg-purple-100')
  })

  test('applies custom className', () => {
    render(<ImplStatusBadge status="complete" className="extra" />)
    const badge = screen.getByTestId('impl-status-badge-complete')
    expect(badge.className).toContain('extra')
  })

  test('falls back to pending for unknown status', () => {
    render(<ImplStatusBadge status="wat" />)
    const badge = screen.getByTestId('impl-status-badge-wat')
    expect(badge.textContent).toBe('Pending')
  })
})
