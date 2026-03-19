import { useState, useEffect, useCallback } from 'react'
import { PipelineEntry, PipelineMetrics, AutonomyLevel } from '../types/autonomy'
import { fetchPipeline } from '../autonomyApi'
import { useGlobalEvents } from './useGlobalEvents'

export interface UsePipelineReturn {
  entries: PipelineEntry[]
  metrics: PipelineMetrics
  autonomyLevel: AutonomyLevel
  loading: boolean
  error: string | null
}

/**
 * Custom hook that fetches pipeline data and subscribes to global SSE events
 * for real-time updates (pipeline_updated, impl_list_updated).
 * 
 * Created by Agent D (wave 2).
 */
export function usePipeline(): UsePipelineReturn {
  const [entries, setEntries] = useState<PipelineEntry[]>([])
  const [metrics, setMetrics] = useState<PipelineMetrics>({
    impls_per_hour: 0,
    avg_wave_seconds: 0,
    queue_depth: 0,
    blocked_count: 0,
    completed_count: 0,
  })
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>('gated')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Fetch pipeline data
  const loadPipeline = async () => {
    try {
      setLoading(true)
      const data = await fetchPipeline()
      setEntries(data.entries)
      setMetrics(data.metrics)
      setAutonomyLevel(data.autonomy_level)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Initial fetch
    loadPipeline()
  }, [])

  const handlePipelineUpdated = useCallback(() => { void loadPipeline() }, [])
  const handleImplListUpdated = useCallback(() => { void loadPipeline() }, [])

  useGlobalEvents({
    pipeline_updated: handlePipelineUpdated,
    impl_list_updated: handleImplListUpdated,
  })

  return { entries, metrics, autonomyLevel, loading, error }
}
