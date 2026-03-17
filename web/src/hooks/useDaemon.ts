import { useState, useEffect } from 'react'
import { DaemonState } from '../types/autonomy'
import { fetchDaemonStatus, subscribeDaemonEvents, startDaemon as startDaemonApi, stopDaemon as stopDaemonApi } from '../autonomyApi'

export interface DaemonEvent {
  type: string
  message: string
  timestamp: string
}

interface UseDaemonReturn {
  state: DaemonState
  events: DaemonEvent[]
  start: () => Promise<void>
  stop: () => Promise<void>
  loading: boolean
  error: string | null
}

export function useDaemon(): UseDaemonReturn {
  const [state, setState] = useState<DaemonState>({
    running: false,
    queue_depth: 0,
    completed_count: 0,
    blocked_count: 0,
  })
  const [events, setEvents] = useState<DaemonEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch initial status on mount
  useEffect(() => {
    fetchDaemonStatus()
      .then(s => {
        setState(s)
        setLoading(false)
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [])

  // Subscribe to daemon events SSE stream
  useEffect(() => {
    const es = subscribeDaemonEvents()

    es.addEventListener('daemon_state', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        setState(data)
      } catch (err) {
        console.error('Failed to parse daemon_state event:', err)
      }
    })

    es.addEventListener('daemon_event', (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data) as DaemonEvent
        setEvents(prev => [...prev.slice(-99), evt]) // Keep last 100 events
      } catch (err) {
        console.error('Failed to parse daemon_event:', err)
      }
    })

    es.onerror = () => {
      // SSE connection closed or error — ignore silently
    }

    return () => {
      es.close()
    }
  }, [])

  async function start() {
    try {
      setError(null)
      const newState = await startDaemonApi()
      setState(newState)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function stop() {
    try {
      setError(null)
      await stopDaemonApi()
      setState(prev => ({ ...prev, running: false }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return { state, events, start, stop, loading, error }
}
