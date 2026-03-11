import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import MarkdownContent from './MarkdownContent'

interface KnownIssue {
  title?: string
  description: string
  status?: string
  workaround?: string
}

interface KnownIssuesPanelProps {
  knownIssues?: KnownIssue[]
}


const STATUS_COLORS: Record<string, string> = {
  'pre-existing': 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20',
  'new': 'bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/20',
  'resolved': 'bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/20',
  'mitigated': 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/20',
}

function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase().trim()
  const colors = STATUS_COLORS[key] || 'bg-muted text-muted-foreground border border-border'
  return <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${colors}`}>{status}</span>
}

export default function KnownIssuesPanel({ knownIssues }: KnownIssuesPanelProps): JSX.Element {
  if (!knownIssues || knownIssues.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Known Issues</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No known issues</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Known Issues</CardTitle>
        <p className="text-xs text-muted-foreground">{knownIssues.length} issue{knownIssues.length !== 1 ? 's' : ''}</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {knownIssues.map((issue, idx) => (
            <div key={idx} className="rounded-lg border border-border/60 bg-muted/30 p-4">
              <div className="flex items-center gap-2 mb-2">
                {issue.title && (
                  <span className="text-sm font-semibold text-foreground">{issue.title}</span>
                )}
                {issue.status && <StatusBadge status={issue.status} />}
              </div>
              {issue.description && (
                <p className="text-xs text-muted-foreground leading-relaxed">{issue.description}</p>
              )}
              {issue.workaround && (
                <div className="mt-2 pl-3 border-l-2 border-primary/30">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70">Workaround: </span>
                    <MarkdownContent>{issue.workaround}</MarkdownContent>
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
