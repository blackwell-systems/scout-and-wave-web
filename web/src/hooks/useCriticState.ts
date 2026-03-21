import { useState, useCallback, useEffect, useMemo } from 'react'
import { sawClient } from '../lib/apiClient'
import { useGlobalEvents } from './useGlobalEvents'
import type { CriticResult, IMPLDocResponse } from '../types'

interface CriticState {
  /** Whether this IMPL meets E37 auto-trigger threshold (3+ wave-1 agents OR 2+ repos) */
  needsCritic: boolean
  /** Fetched critic report, or null if not yet run */
  criticReport: CriticResult | null
  /** Whether critic is currently running */
  criticRunning: boolean
  /** Accumulated live output from critic agent */
  criticOutput: string
  /** Error message if critic review failed */
  criticError: string | null
  /** Trigger critic review */
  runCritic: () => void
}

export function useCriticState(slug: string, impl: IMPLDocResponse | null): CriticState {
  const [criticReport, setCriticReport] = useState<CriticResult | null>(null)
  const [criticRunning, setCriticRunning] = useState(false)
  const [criticOutput, setCriticOutput] = useState('')
  const [criticError, setCriticError] = useState<string | null>(null)

  const needsCritic = useMemo(() => {
    if (!impl) return false
    const wave1 = impl.waves.find(w => w.number === 1)
    if (wave1 && wave1.agents.length >= 3) return true
    const repos = new Set(
      impl.file_ownership.map(fo => fo.repo).filter(r => r && r !== 'system')
    )
    return repos.size >= 2
  }, [impl])

  const fetchCritic = useCallback(() => {
    sawClient.impl.criticReview(slug)
      .then(data => { setCriticReport(data); setCriticRunning(false) })
      .catch(() => { setCriticReport(null); setCriticRunning(false) })
  }, [slug])

  useEffect(() => { fetchCritic() }, [fetchCritic])

  const runCritic = useCallback(async () => {
    setCriticRunning(true)
    try {
      await sawClient.impl.runCritic(slug)
      // SSE critic_review_complete will trigger fetchCritic
    } catch {
      setCriticRunning(false)
    }
  }, [slug])

  const handleCriticComplete = useCallback((e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data)
      if (data?.slug === slug) fetchCritic()
    } catch { /* ignore */ }
  }, [slug, fetchCritic])

  const handleCriticStarted = useCallback((e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data)
      if (data?.slug === slug) {
        setCriticRunning(true)
        setCriticOutput('')
        setCriticError(null)
      }
    } catch { /* ignore */ }
  }, [slug])

  const handleCriticOutput = useCallback((e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data)
      if (data?.slug === slug) {
        setCriticOutput(prev => prev + (data.chunk ?? ''))
      }
    } catch { /* ignore */ }
  }, [slug])

  const handleCriticFailed = useCallback((e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data)
      if (data?.slug === slug) {
        setCriticRunning(false)
        setCriticError(data.error ?? 'Critic review failed')
      }
    } catch { /* ignore */ }
  }, [slug])

  useGlobalEvents({
    critic_review_complete: handleCriticComplete,
    critic_review_started: handleCriticStarted,
    critic_output: handleCriticOutput,
    critic_review_failed: handleCriticFailed,
  })

  return { needsCritic, criticReport, criticRunning, criticOutput, criticError, runCritic }
}
