interface DimensionScore {
  name: string
  score: number
  rationale: string
}

interface ReviewResultPanelProps {
  overall: number
  passed: boolean
  summary: string
  dimensions: DimensionScore[]
  model: string
  wave: number
}

function formatDimName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function scoreBarColor(score: number): string {
  if (score >= 80) return 'bg-green-500'
  if (score >= 60) return 'bg-yellow-500'
  return 'bg-red-500'
}

export default function ReviewResultPanel(props: ReviewResultPanelProps): JSX.Element {
  const { overall, passed, summary, dimensions, model, wave } = props

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          AI Code Review — Wave {wave}
        </h3>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded ${
              passed
                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
            }`}
          >
            {passed ? 'PASSED' : 'FAILED'}
          </span>
          <span className="text-sm font-mono text-foreground">{overall}%</span>
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <p className="text-xs text-muted-foreground leading-relaxed">{summary}</p>
      )}

      {/* Dimension cards */}
      {dimensions.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {dimensions.map(dim => (
            <div key={dim.name} className="rounded-md border border-border bg-background p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">{formatDimName(dim.name)}</span>
                <span className="text-xs font-mono text-muted-foreground">{dim.score}/100</span>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${scoreBarColor(dim.score)}`}
                  style={{ width: `${dim.score}%` }}
                />
              </div>
              {/* Rationale */}
              <p className="text-xs text-muted-foreground leading-snug">{dim.rationale}</p>
            </div>
          ))}
        </div>
      )}

      {/* Model attribution */}
      <p className="text-xs text-muted-foreground">Reviewed by {model}</p>
    </div>
  )
}
