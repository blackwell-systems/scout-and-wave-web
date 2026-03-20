// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import AgentCard from './AgentCard'
import { AgentStatus } from '../types'

// Mock ToolFeed since it's not relevant to these tests
vi.mock('./ToolFeed', () => ({
  default: () => <div data-testid="tool-feed" />,
}))

function makeAgent(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    agent: 'A',
    wave: 1,
    files: [],
    status: 'pending',
    ...overrides,
  }
}

describe('AgentCard', () => {
  test('renders agent letter and status', () => {
    render(<AgentCard agent={makeAgent({ status: 'running', startedAt: Date.now() })} />)
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  test('shows failure explanation for merge_conflict', () => {
    render(
      <AgentCard
        agent={makeAgent({
          status: 'failed',
          failure_type: 'merge_conflict',
          message: 'conflict in pkg/foo.go',
        })}
      />
    )
    expect(screen.getByText('Merge Conflict')).toBeInTheDocument()
    expect(screen.getByText('Why did this fail?')).toBeInTheDocument()
    expect(screen.getByText(/File ownership overlap/)).toBeInTheDocument()
    expect(screen.getByText('What can I do?')).toBeInTheDocument()
    expect(screen.getByText(/Check File Ownership table/)).toBeInTheDocument()
    expect(screen.getByText('conflict in pkg/foo.go')).toBeInTheDocument()
  })

  test('shows failure explanation for failed_gate', () => {
    render(
      <AgentCard
        agent={makeAgent({
          status: 'failed',
          failure_type: 'failed_gate',
          message: 'go vet failed',
        })}
      />
    )
    expect(screen.getByText('Quality Gate Failed')).toBeInTheDocument()
    expect(screen.getByText(/Build, test, or lint/)).toBeInTheDocument()
    expect(screen.getByText(/Review gate output/)).toBeInTheDocument()
  })

  test('shows failure explanation for timeout', () => {
    render(
      <AgentCard
        agent={makeAgent({
          status: 'failed',
          failure_type: 'timeout',
          message: 'exceeded limit',
        })}
      />
    )
    expect(screen.getByText('Agent Timeout')).toBeInTheDocument()
    expect(screen.getByText(/exceeded max execution time/)).toBeInTheDocument()
  })

  test('falls back to unknown explanation for unrecognized failure_type', () => {
    render(
      <AgentCard
        agent={makeAgent({
          status: 'failed',
          failure_type: 'some_new_type',
          message: 'something broke',
        })}
      />
    )
    expect(screen.getByText('Unknown Error')).toBeInTheDocument()
    expect(screen.getByText('Unexpected failure')).toBeInTheDocument()
    expect(screen.getByText('something broke')).toBeInTheDocument()
  })

  test('shows failure with message only (no failure_type)', () => {
    render(
      <AgentCard
        agent={makeAgent({
          status: 'failed',
          message: 'generic error',
        })}
      />
    )
    expect(screen.getByText('Unknown Error')).toBeInTheDocument()
    expect(screen.getByText('generic error')).toBeInTheDocument()
  })

  test('does not show failure section for non-failed agents', () => {
    render(<AgentCard agent={makeAgent({ status: 'complete' })} />)
    expect(screen.queryByText('Why did this fail?')).not.toBeInTheDocument()
  })

  test('uses semantic dl/dt/dd elements', () => {
    const { container } = render(
      <AgentCard
        agent={makeAgent({
          status: 'failed',
          failure_type: 'timeout',
          message: 'timed out',
        })}
      />
    )
    expect(container.querySelector('dl')).toBeInTheDocument()
    expect(container.querySelectorAll('dt').length).toBeGreaterThanOrEqual(2)
    expect(container.querySelectorAll('dd').length).toBeGreaterThanOrEqual(2)
  })
})
