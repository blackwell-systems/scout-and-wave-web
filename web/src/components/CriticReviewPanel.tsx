import { useState } from 'react'

// Local type definitions — canonical types are in types.ts (Agent G)
interface CriticIssueType {
  check: string
  severity: 'error' | 'warning'
  description: string
  file?: string
  symbol?: string
}

interface AgentCriticReviewType {
  agent_id: string
  verdict: 'PASS' | 'ISSUES'
  issues?: CriticIssueType[]
}

interface CriticResultType {
  verdict: 'PASS' | 'ISSUES'
  agent_reviews: Record<string, AgentCriticReviewType>
  summary: string
  reviewed_at: string
  issue_count: number
}

interface CriticReviewPanelProps {
  result: CriticResultType
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

export function CriticReviewPanel({ result }: CriticReviewPanelProps): JSX.Element {
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

  return (
    <div className="rounded-lg border border-border bg-card flex flex-col gap-4 overflow-hidden">
      {/* Overall verdict banner */}
      <div
        className={`flex items-center gap-3 px-4 py-3 ${
          isPass
            ? 'bg-green-100 dark:bg-green-900/50 border-b border-green-200 dark:border-green-800'
            : 'bg-red-100 dark:bg-red-900/50 border-b border-red-200 dark:border-red-800'
        }`}
      >
        <span
          className={`flex items-center justify-center w-7 h-7 rounded-full text-base font-bold ${
            isPass
              ? 'bg-green-200 dark:bg-green-800 text-green-700 dark:text-green-200'
              : 'bg-red-200 dark:bg-red-800 text-red-700 dark:text-red-200'
          }`}
          aria-hidden="true"
        >
          {isPass ? '✓' : '!'}
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
              ? 'All briefs verified — wave execution may proceed'
              : `Brief verification found ${result.issue_count} issue${result.issue_count !== 1 ? 's' : ''} — review before executing`}
          </span>
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
      </div>

      {/* Summary text */}
      {result.summary && (
        <p className="px-4 text-xs text-muted-foreground leading-relaxed">{result.summary}</p>
      )}

      {/* Per-agent accordion */}
      {agentEntries.length > 0 && (
        <div className="px-4 flex flex-col gap-2">
          {agentEntries.map(([key, review]) => {
            const isExpanded = expandedAgents.has(key)
            const agentIsPass = review.verdict === 'PASS'
            const issueCount = review.issues?.length ?? 0

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
                    {isExpanded ? '▼' : '▶'}
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

      {/* Reviewed at timestamp */}
      <p className="px-4 pb-4 text-xs text-muted-foreground">
        Reviewed at: {formatReviewedAt(result.reviewed_at)}
      </p>
    </div>
  )
}
