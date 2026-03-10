import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import KnownIssuesPanel from './KnownIssuesPanel'

describe('KnownIssuesPanel', () => {
  test('renders empty state when no issues provided', () => {
    render(<KnownIssuesPanel knownIssues={[]} />)
    expect(screen.getByText(/No known issues/i)).toBeInTheDocument()
  })

  test('renders empty state when undefined', () => {
    render(<KnownIssuesPanel />)
    expect(screen.getByText(/No known issues/i)).toBeInTheDocument()
  })

  test('renders structured issue with title field', () => {
    const issues = [
      {
        title: 'Flaky test',
        description: 'Test fails intermittently',
        status: 'Pre-existing',
      },
    ]

    render(<KnownIssuesPanel knownIssues={issues} />)
    expect(screen.getByText(/Flaky test/)).toBeInTheDocument()
    expect(screen.getByText(/Test fails intermittently/)).toBeInTheDocument()
    expect(screen.getByText(/Pre-existing/i)).toBeInTheDocument()
  })

  test('renders issue without title field', () => {
    const issues = [
      {
        description: 'Something is broken',
        status: 'New',
      },
    ]

    render(<KnownIssuesPanel knownIssues={issues} />)
    expect(screen.getByText(/Something is broken/)).toBeInTheDocument()
    expect(screen.getByText(/New/i)).toBeInTheDocument()
  })

  test('renders multiple issues', () => {
    const issues = [
      {
        title: 'Issue 1',
        description: 'First problem',
        status: 'Pre-existing',
      },
      {
        title: 'Issue 2',
        description: 'Second problem',
        status: 'New',
      },
    ]

    render(<KnownIssuesPanel knownIssues={issues} />)
    expect(screen.getByText(/Issue 1/)).toBeInTheDocument()
    expect(screen.getByText(/First problem/)).toBeInTheDocument()
    expect(screen.getByText(/Issue 2/)).toBeInTheDocument()
    expect(screen.getByText(/Second problem/)).toBeInTheDocument()
  })

  test('renders workaround when provided', () => {
    const issues = [
      {
        title: 'Memory leak',
        description: 'App crashes after 10 minutes',
        status: 'Pre-existing',
        workaround: 'Restart the service every 5 minutes',
      },
    ]

    render(<KnownIssuesPanel knownIssues={issues} />)
    expect(screen.getByText(/Memory leak/)).toBeInTheDocument()
    expect(screen.getByText(/Restart the service every 5 minutes/)).toBeInTheDocument()
  })

  test('displays issue count', () => {
    const issues = [
      { description: 'Issue 1', status: 'New' },
      { description: 'Issue 2', status: 'New' },
      { description: 'Issue 3', status: 'New' },
    ]

    render(<KnownIssuesPanel knownIssues={issues} />)
    expect(screen.getByText(/3 issues/i)).toBeInTheDocument()
  })

  test('displays singular issue count', () => {
    const issues = [{ description: 'Issue 1', status: 'New' }]

    render(<KnownIssuesPanel knownIssues={issues} />)
    expect(screen.getByText(/1 issue$/i)).toBeInTheDocument()
  })
})
