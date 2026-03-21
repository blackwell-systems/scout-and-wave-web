import { useState, useCallback, useEffect, useMemo } from 'react'
import { sawClient } from '../lib/apiClient'
import { useGlobalEvents } from './useGlobalEvents'
import type { CriticResult, CriticFixRequest, IMPLDocResponse } from '../types'

/** Response shape from POST /api/impl/{slug}/auto-fix-critic */
interface AutoFixCriticResponse {
  fixes_applied: Array<{ check: string; agent_id: string; description: string }>
  fixes_failed: Array<{ check: string; agent_id: string; reason: string }>
  new_result?: CriticResult
  all_resolved: boolean
}

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
  /** Apply a single critic fix */
  applyCriticFix: (fix: CriticFixRequest) => Promise<void>
  /** Run auto-fix for all fixable issues, re-validate, re-run critic */
  autoFixAll: () => Promise<void>
  /** Whether auto-fix is in progress */
  autoFixRunning: boolean
  /** Auto-fix result summary (null when not run) */
  autoFixResult: AutoFixCriticResponse | null
}

export function useCriticState(slug: string, impl: IMPLDocResponse | null): CriticState {
  const [criticReport, setCriticReport] = useState<CriticResult | null>(null)
  const [criticRunning, setCriticRunning] = useState(false)
  const [criticOutput, setCriticOutput] = useState('')
  const [criticError, setCriticError] = useState<string | null>(null)
  const [autoFixRunning, setAutoFixRunning] = useState(false)
  const [autoFixResult, setAutoFixResult] = useState<AutoFixCriticResponse | null>(null)

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

  const applyCriticFix = useCallback(async (fix: CriticFixRequest) => {
    await sawClient.impl.applyCriticFix(slug, fix)
    fetchCritic()
  }, [slug, fetchCritic])

  const autoFixAll = useCallback(async () => {
    setAutoFixRunning(true)
    setAutoFixResult(null)
    try {
      // Inline fetch: autoFixCritic client method is added by Agent B in parallel
      const r = await fetch(`/api/impl/${encodeURIComponent(slug)}/auto-fix-critic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!r.ok) throw new Error(await r.text())
      const data = (await r.json()) as AutoFixCriticResponse
      setAutoFixResult(data)
      if (data.new_result) {
        setCriticReport(data.new_result)
      } else {
        fetchCritic()
      }
    } catch (err) {
      setCriticError(err instanceof Error ? err.message : String(err))
    } finally {
      setAutoFixRunning(false)
    }
  }, [slug, fetchCritic])

  return {
    needsCritic, criticReport, criticRunning, criticOutput, criticError, runCritic,
    applyCriticFix, autoFixAll, autoFixRunning, autoFixResult,
  }
}
