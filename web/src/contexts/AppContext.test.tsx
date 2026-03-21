import { render, screen, act } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { AppProvider, useAppContext } from './AppContext'

// Mock API modules
vi.mock('../api', () => ({
  listImpls: vi.fn().mockResolvedValue([]),
  getConfig: vi.fn().mockResolvedValue({
    repos: [{ name: 'test-repo', path: '/tmp/test' }],
    agent: {
      scout_model: 'claude-sonnet-4-6',
      critic_model: 'claude-sonnet-4-6',
      scaffold_model: 'claude-sonnet-4-6',
      wave_model: 'claude-sonnet-4-6',
      integration_model: 'claude-sonnet-4-6',
      chat_model: 'claude-sonnet-4-6',
      planner_model: 'claude-sonnet-4-6',
    },
  }),
  saveConfig: vi.fn().mockResolvedValue(undefined),
  fetchInterruptedSessions: vi.fn().mockResolvedValue([]),
}))

vi.mock('../programApi', () => ({
  listPrograms: vi.fn().mockResolvedValue([]),
}))

vi.mock('../hooks/useGlobalEvents', () => ({
  useGlobalEvents: vi.fn(),
}))

function TestConsumer() {
  const ctx = useAppContext()
  return (
    <div>
      <span data-testid="sse">{String(ctx.sseConnected)}</span>
      <span data-testid="entries">{ctx.entries.length}</span>
      <span data-testid="repos">{ctx.repos.length}</span>
      <span data-testid="scout-model">{ctx.models.scout}</span>
      <span data-testid="active-repo">{ctx.activeRepo?.name ?? 'none'}</span>
      <span data-testid="programs">{ctx.programs.length}</span>
    </div>
  )
}

describe('AppContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('provides correct initial default values', () => {
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>
    )
    // Before config loads, defaults apply
    expect(screen.getByTestId('sse').textContent).toBe('false')
    expect(screen.getByTestId('entries').textContent).toBe('0')
    expect(screen.getByTestId('scout-model').textContent).toBe('claude-sonnet-4-6')
    expect(screen.getByTestId('programs').textContent).toBe('0')
  })

  test('loads repos from config on mount', async () => {
    await act(async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>
      )
    })
    // After config resolves, repos should be populated
    expect(screen.getByTestId('repos').textContent).toBe('1')
    expect(screen.getByTestId('active-repo').textContent).toBe('test-repo')
  })

  test('useAppContext throws meaningful data outside provider', () => {
    // useAppContext returns default value (no throw) when used outside provider
    render(<TestConsumer />)
    expect(screen.getByTestId('sse').textContent).toBe('false')
    expect(screen.getByTestId('active-repo').textContent).toBe('none')
  })
})
