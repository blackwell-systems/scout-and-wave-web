import { render, screen, fireEvent } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import { LoadingSpinner, LoadingSkeleton, ErrorDisplay, EmptyState } from './StateDisplays'

describe('LoadingSpinner', () => {
  test('renders with role=status', () => {
    render(<LoadingSpinner />)
    expect(screen.getByRole('status')).toBeDefined()
  })

  test('renders with testid', () => {
    render(<LoadingSpinner />)
    expect(screen.getByTestId('loading-spinner')).toBeDefined()
  })

  test('applies custom className', () => {
    render(<LoadingSpinner className="h-8 w-8" />)
    const el = screen.getByTestId('loading-spinner')
    expect(el.className).toContain('h-8')
    expect(el.className).toContain('w-8')
  })

  test('has animate-spin class', () => {
    render(<LoadingSpinner />)
    expect(screen.getByTestId('loading-spinner').className).toContain('animate-spin')
  })
})

describe('LoadingSkeleton', () => {
  test('renders default 3 lines', () => {
    render(<LoadingSkeleton />)
    const container = screen.getByTestId('loading-skeleton')
    // Each "line" is a div with space-y-2 containing 3 pulse bars
    const groups = container.querySelectorAll('.space-y-2')
    expect(groups.length).toBe(3)
  })

  test('renders custom number of lines', () => {
    render(<LoadingSkeleton lines={5} />)
    const container = screen.getByTestId('loading-skeleton')
    const groups = container.querySelectorAll('.space-y-2')
    expect(groups.length).toBe(5)
  })

  test('applies custom className', () => {
    render(<LoadingSkeleton className="mt-4" />)
    const container = screen.getByTestId('loading-skeleton')
    expect(container.className).toContain('mt-4')
  })

  test('skeleton bars have animate-pulse', () => {
    render(<LoadingSkeleton lines={1} />)
    const container = screen.getByTestId('loading-skeleton')
    const bars = container.querySelectorAll('.animate-pulse')
    expect(bars.length).toBeGreaterThanOrEqual(3)
  })
})

describe('ErrorDisplay', () => {
  test('renders error message', () => {
    render(<ErrorDisplay message="Something went wrong" />)
    expect(screen.getByText('Something went wrong')).toBeDefined()
  })

  test('renders without retry button when onRetry is not provided', () => {
    render(<ErrorDisplay message="Error" />)
    expect(screen.queryByText('Retry')).toBeNull()
  })

  test('renders retry button when onRetry is provided', () => {
    const onRetry = vi.fn()
    render(<ErrorDisplay message="Error" onRetry={onRetry} />)
    const btn = screen.getByText('Retry')
    expect(btn).toBeDefined()
  })

  test('calls onRetry when retry button is clicked', () => {
    const onRetry = vi.fn()
    render(<ErrorDisplay message="Error" onRetry={onRetry} />)
    fireEvent.click(screen.getByText('Retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('has destructive text styling', () => {
    render(<ErrorDisplay message="Bad" />)
    const msg = screen.getByText('Bad')
    expect(msg.className).toContain('text-destructive')
  })
})

describe('EmptyState', () => {
  test('renders title', () => {
    render(<EmptyState title="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeDefined()
  })

  test('renders description when provided', () => {
    render(<EmptyState title="Empty" description="No items found" />)
    expect(screen.getByText('No items found')).toBeDefined()
  })

  test('does not render description when not provided', () => {
    const { container } = render(<EmptyState title="Empty" />)
    const desc = container.querySelector('.text-muted-foreground')
    expect(desc).toBeNull()
  })

  test('renders icon when provided', () => {
    render(<EmptyState title="Empty" icon={<svg data-testid="my-icon" />} />)
    expect(screen.getByTestId('my-icon')).toBeDefined()
  })

  test('renders action when provided', () => {
    render(<EmptyState title="Empty" action={<button>Do thing</button>} />)
    expect(screen.getByText('Do thing')).toBeDefined()
  })

  test('renders without icon or action gracefully', () => {
    render(<EmptyState title="Just a title" />)
    const el = screen.getByTestId('empty-state')
    expect(el).toBeDefined()
    expect(screen.getByText('Just a title')).toBeDefined()
  })
})
