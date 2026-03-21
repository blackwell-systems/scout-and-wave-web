import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { sawClient } from '../lib/apiClient'

// ─── Response types (implemented by Agent B's API endpoints) ─────────────────

export interface IntegrationGap {
  file: string
  line?: number
  reason: string
  type?: 'syntax' | 'semantic'
  severity?: 'high' | 'medium' | 'low'
}

export interface WiringGap {
  file: string
  line?: number
  reason: string
  type?: 'syntax' | 'semantic'
  severity?: 'high' | 'medium' | 'low'
}

export interface ValidateIntegrationResponse {
  valid: boolean
  wave: number
  gaps: IntegrationGap[]
}

export interface ValidateWiringResponse {
  valid: boolean
  gaps: WiringGap[]
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ValidationPanelProps {
  slug: string
  currentWave?: number
}

// ─── Severity helpers ─────────────────────────────────────────────────────────

function severityBadgeClass(severity?: string): string {
  switch (severity) {
    case 'high':   return 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'
    case 'medium': return 'bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800'
    case 'low':    return 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800'
    default:       return 'bg-muted text-muted-foreground border-border'
  }
}

function severityRowClass(severity?: string): string {
  switch (severity) {
    case 'high':   return 'border-red-200 dark:border-red-900'
    case 'medium': return 'border-yellow-200 dark:border-yellow-900'
    case 'low':    return 'border-blue-200 dark:border-blue-900'
    default:       return 'border-border'
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function GapList({ gaps }: { gaps: IntegrationGap[] | WiringGap[] }): JSX.Element {
  if (gaps.length === 0) {
    return (
      <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-lg">
        <svg className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-sm text-green-700 dark:text-green-400">No gaps found</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {gaps.map((gap, i) => (
        <div
          key={i}
          className={`p-3 bg-background border rounded-lg ${severityRowClass(gap.severity)}`}
        >
          <div className="flex items-start gap-2 flex-wrap">
            <code className="px-1.5 py-0.5 text-xs font-mono bg-muted text-foreground rounded shrink-0">
              {gap.file}{gap.line !== undefined ? `:${gap.line}` : ''}
            </code>
            {gap.type && (
              <span className="px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground rounded shrink-0">
                {gap.type}
              </span>
            )}
            {gap.severity && (
              <span className={`px-1.5 py-0.5 text-xs font-medium border rounded shrink-0 ${severityBadgeClass(gap.severity)}`}>
                {gap.severity}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-foreground">{gap.reason}</p>
        </div>
      ))}
    </div>
  )
}

function ValidationResultPanel({ valid, label, gaps }: {
  valid: boolean
  label: string
  gaps: IntegrationGap[] | WiringGap[]
}): JSX.Element {
  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 p-3 rounded-lg border ${
        valid
          ? 'bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800'
          : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800'
      }`}>
        {valid ? (
          <svg className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        <span className={`text-sm font-medium ${valid ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
          {label}: {valid ? 'Valid' : `${gaps.length} gap${gaps.length !== 1 ? 's' : ''} found`}
        </span>
      </div>
      {!valid && <GapList gaps={gaps} />}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ValidationPanel({ slug, currentWave }: ValidationPanelProps): JSX.Element {
  const [integrationResult, setIntegrationResult] = useState<ValidateIntegrationResponse | null>(null)
  const [wiringResult, setWiringResult] = useState<ValidateWiringResponse | null>(null)
  const [isValidating, setIsValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleValidateIntegration() {
    if (currentWave === undefined) return
    setIsValidating(true)
    setError(null)
    try {
      const result = await (sawClient.impl as any).validateIntegration(slug, currentWave)
      setIntegrationResult(result as ValidateIntegrationResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Integration validation failed')
    } finally {
      setIsValidating(false)
    }
  }

  async function handleValidateWiring() {
    setIsValidating(true)
    setError(null)
    try {
      const result = await (sawClient.impl as any).validateWiring(slug)
      setWiringResult(result as ValidateWiringResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wiring validation failed')
    } finally {
      setIsValidating(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Validation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          {currentWave !== undefined && (
            <button
              onClick={handleValidateIntegration}
              disabled={isValidating}
              data-testid="validate-integration-btn"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-border bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              {isValidating ? (
                <span data-testid="spinner" className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : null}
              Validate Integration (Wave {currentWave})
            </button>
          )}
          <button
            onClick={handleValidateWiring}
            disabled={isValidating}
            data-testid="validate-wiring-btn"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-border bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            {isValidating ? (
              <span data-testid="spinner" className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : null}
            Validate Wiring
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Integration validation result */}
        {integrationResult && (
          <ValidationResultPanel
            valid={integrationResult.valid}
            label={`Integration (Wave ${integrationResult.wave})`}
            gaps={integrationResult.gaps}
          />
        )}

        {/* Wiring validation result */}
        {wiringResult && (
          <ValidationResultPanel
            valid={wiringResult.valid}
            label="Wiring"
            gaps={wiringResult.gaps}
          />
        )}
      </CardContent>
    </Card>
  )
}
