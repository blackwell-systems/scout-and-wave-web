import { useState, useCallback } from 'react'
import type { CriticResult, CriticIssue, CriticFixRequest } from '../types'

interface CriticReviewPanelProps {
  result: CriticResult
  onApplyFix?: (fix: CriticFixRequest) => Promise<void>
  onRerunCritic?: () => void
  criticRunning?: boolean
}

function formatReviewedAt(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/** Compute a suggested fix for an issue, or null if no auto-fix is available. */
function getSuggestedFix(issue: CriticIssue, agentId: string, wave: number): { label: string; fix: CriticFixRequest } | null {
  if (
    (issue.check === 'file_existence' || issue.check === 'side_effect_completeness') &&
    issue.severity === 'error' &&
    issue.file
  ) {
    return {
      label: `Add ${issue.file} to Agent ${agentId}'s file_ownership (wave ${wave})`,
      fix: {
        type: 'add_file_ownership',
        agent_id: agentId,
        wave,
        file: issue.file,
        action: 'modify',
      },
    }
  }

  if (issue.check === 'symbol_accuracy' && issue.severity === 'warning') {
    // Check for "expected X, found Y" pattern
    const match = issue.description.match(/expected\s+(\S+),\s+found\s+(\S+)/)
    if (match) {
      return {
        label: `Update contract: ${match[1]} -> ${match[2]}`,
        fix: {
          type: 'update_contract',
          agent_id: agentId,
          wave,
          old_symbol: match[1],
          new_symbol: match[2],
        },
      }
    }
    // No auto-fix for symbol_accuracy without the pattern
    return null
  }

  // import_chains: informational only, no auto-fix
  // All other check types: no auto-fix
  return null
}

/** Get informational text for an issue (shown even when no auto-fix). */
function getInfoText(issue: CriticIssue): string | null {
  if (issue.check === 'symbol_accuracy' && issue.severity === 'warning') {
    return `Contract says ${issue.symbol ?? 'unknown'}, codebase may differ`
  }
  if (issue.check === 'import_chains') {
    return 'Package not in go.mod -- manual fix required'
  }
  return null
}

type IssueFixState = 'idle' | 'loading' | 'success' | 'error'

interface IssueFixStatus {
  state: IssueFixState
  error?: string
}

function IssueFixer({
  issue,
  agentId,
  wave,
  onApplyFix,
}: {
  issue: CriticIssue
  agentId: string
  wave: number
  onApplyFix?: (fix: CriticFixRequest) => Promise<void>
}): JSX.Element | null {
  const [fixStatus, setFixStatus] = useState<IssueFixStatus>({ state: 'idle' })

  const suggested = getSuggestedFix(issue, agentId, wave)
  const infoText = getInfoText(issue)

  const handleApply = useCallback(async () => {
    if (!suggested || !onApplyFix) return
    setFixStatus({ state: 'loading' })
    try {
      await onApplyFix(suggested.fix)
      setFixStatus({ state: 'success' })
    } catch (err) {
      setFixStatus({ state: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }, [suggested, onApplyFix])

  if (!suggested && !infoText) return null

  return (
    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
      {infoText && (
        <span className="text-[11px] text-muted-foreground italic">{infoText}</span>
      )}
      {suggested && onApplyFix && fixStatus.state === 'idle' && (
        <button
          onClick={handleApply}
          className="text-[11px] font-medium px-2 py-0.5 rounded border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
        >
          Apply Fix
        </button>
      )}
      {suggested && fixStatus.state === 'idle' && (
        <span className="text-[11px] text-muted-foreground">{suggested.label}</span>
      )}
      {fixStatus.state === 'loading' && (
        <span className="text-[11px] text-muted-foreground animate-pulse">Applying fix...</span>
      )}
      {fixStatus.state === 'success' && (
        <span className="text-[11px] text-green-600 dark:text-green-400 font-medium">
          &#10003; Fixed
        </span>
      )}
      {fixStatus.state === 'error' && (
        <span className="text-[11px] text-red-600 dark:text-red-400">{fixStatus.error}</span>
      )}
    </div>
  )
}

function countIssueBySeverity(result: CriticResult): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const review of Object.values(result.agent_reviews)) {
    for (const issue of review.issues ?? []) {
      if (issue.severity === 'error') errors++
      else warnings++
    }
  }
  return { errors, warnings }
}

export function CriticReviewPanel({ result, onApplyFix, onRerunCritic, criticRunning }: CriticReviewPanelProps): JSX.Element {
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())

  const toggleAgent = (agentId: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev)
      if (next.has(agentId)) {
        next.delete(agentId)
      } else {
        next.add(agentId)
      }
      return next
    })
  }

  const isPass = result.verdict === 'PASS'
  const agentEntries = Object.entries(result.agent_reviews).sort(([a], [b]) => a.localeCompare(b))
  const { errors, warnings } = countIssueBySeverity(result)
  const [expanded, setExpanded] = useState(!isPass)

  // Derive wave number from agent reviews (best effort: take first agent's wave or default to 1)
  const getWaveForAgent = (_agentId: string): number => {
    // The CriticResult doesn't carry wave info per-agent. Default to 1 since critic
    // reviews are typically run for wave-1 briefs.
    return 1
  }

  return (
    <div className="rounded-none border border-border bg-card flex flex-col overflow-hidden">
      {/* Overall verdict banner — clickable to expand/collapse */}
      <button
        onClick={() => setExpanded(prev => !prev)}
        className={`flex items-center gap-3 px-4 py-3 w-full text-left transition-colors ${
          isPass
            ? 'bg-green-100 dark:bg-green-900/50 hover:bg-green-200/60 dark:hover:bg-green-900/70'
            : 'bg-red-100 dark:bg-red-900/50 hover:bg-red-200/60 dark:hover:bg-red-900/70'
        }${expanded ? (isPass ? ' border-b border-green-200 dark:border-green-800' : ' border-b border-red-200 dark:border-red-800') : ''}`}
      >
        <span
          className={`flex items-center justify-center w-7 h-7 rounded-full text-base font-bold ${
            isPass
              ? 'bg-green-200 dark:bg-green-800 text-green-700 dark:text-green-200'
              : 'bg-red-200 dark:bg-red-800 text-red-700 dark:text-red-200'
          }`}
          aria-hidden="true"
        >
          {isPass ? '\u2713' : '!'}
        </span>
        <div className="flex flex-col">
          <span
            className={`text-sm font-semibold ${
              isPass
                ? 'text-green-800 dark:text-green-200'
                : 'text-red-800 dark:text-red-200'
            }`}
          >
            {isPass
              ? 'All briefs verified -- wave execution may proceed'
              : `Brief verification found ${result.issue_count} issue${result.issue_count !== 1 ? 's' : ''} -- review before executing`}
          </span>
          {/* Issue count summary */}
          {!isPass && (
            <span className="text-xs text-muted-foreground mt-0.5">
              {errors > 0 && `${errors} error${errors !== 1 ? 's' : ''}`}
              {errors > 0 && warnings > 0 && ', '}
              {warnings > 0 && `${warnings} warning${warnings !== 1 ? 's' : ''}`}
            </span>
          )}
          {isPass && (
            <span className="text-xs text-green-700 dark:text-green-300 mt-0.5">All issues resolved</span>
          )}
        </div>
        <span
          className={`ml-auto text-xs font-bold px-2 py-0.5 rounded ${
            isPass
              ? 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200'
              : 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200'
          }`}
        >
          {result.verdict}
        </span>
        <span className={`text-xs transition-transform duration-200 ${expanded ? '' : '-rotate-90'} ${isPass ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          &#x25BC;
        </span>
      </button>

      {/* Collapsible body */}
      {expanded && <>
      {/* Summary text */}
      {result.summary && (
        <p className="px-4 pt-4 text-xs text-muted-foreground leading-relaxed">{result.summary}</p>
      )}

      {/* Per-agent accordion */}
      {agentEntries.length > 0 && (
        <div className="px-4 flex flex-col gap-2">
          {agentEntries.map(([key, review]) => {
            const isExpanded = expandedAgents.has(key)
            const agentIsPass = review.verdict === 'PASS'
            const issueCount = review.issues?.length ?? 0
            const agentWave = getWaveForAgent(review.agent_id)

            return (
              <div
                key={key}
                className="rounded-md border border-border overflow-hidden"
              >
                {/* Accordion header row */}
                <button
                  onClick={() => toggleAgent(key)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 bg-background hover:bg-muted transition-colors text-left"
                  aria-expanded={isExpanded}
                >
                  {/* Expand/collapse indicator */}
                  <span className="text-muted-foreground text-xs w-3 flex-shrink-0">
                    {isExpanded ? '\u25BC' : '\u25B6'}
                  </span>

                  {/* Agent ID */}
                  <span className="text-sm font-mono font-semibold text-foreground">
                    Agent {review.agent_id}
                  </span>

                  {/* Issue count hint when collapsed */}
                  {!isExpanded && issueCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {issueCount} issue{issueCount !== 1 ? 's' : ''}
                    </span>
                  )}

                  {/* Verdict badge */}
                  <span
                    className={`ml-auto text-xs font-bold px-2 py-0.5 rounded ${
                      agentIsPass
                        ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200'
                        : 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200'
                    }`}
                  >
                    {review.verdict}
                  </span>
                </button>

                {/* Expanded: issues list */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/30">
                    {issueCount === 0 ? (
                      <p className="px-4 py-3 text-xs text-muted-foreground">No issues found.</p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {review.issues!.map((issue, idx) => (
                          <li key={idx} className="px-4 py-3 flex flex-col gap-1">
                            {/* Check name + severity badge */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono font-semibold text-foreground">
                                {issue.check}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                                  issue.severity === 'error'
                                    ? 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300'
                                    : 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300'
                                }`}
                              >
                                {issue.severity}
                              </span>
                            </div>

                            {/* Description */}
                            <p className="text-xs text-muted-foreground leading-snug">
                              {issue.description}
                            </p>

                            {/* Optional file + symbol */}
                            {(issue.file || issue.symbol) && (
                              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                                {issue.file && (
                                  <span className="text-xs font-mono text-foreground/70 bg-muted px-1.5 py-0.5 rounded">
                                    {issue.file}
                                  </span>
                                )}
                                {issue.symbol && (
                                  <span className="text-xs font-mono text-foreground/70 bg-muted px-1.5 py-0.5 rounded">
                                    {issue.symbol}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Auto-fix suggestion */}
                            <IssueFixer
                              issue={issue}
                              agentId={review.agent_id}
                              wave={agentWave}
                              onApplyFix={onApplyFix}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer: reviewed at + re-run button */}
      <div className="px-4 pb-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Reviewed at: {formatReviewedAt(result.reviewed_at)}
        </p>
        {onRerunCritic && (
          <button
            onClick={(e) => { e.stopPropagation(); onRerunCritic() }}
            disabled={criticRunning}
            className="flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-none border border-border bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {criticRunning && (
              <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            )}
            {criticRunning ? 'Running...' : 'Re-run Critic'}
          </button>
        )}
      </div>
      </>}
    </div>
  )
}
