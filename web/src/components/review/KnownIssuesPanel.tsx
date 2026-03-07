import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'

interface KnownIssue {
  description: string
  status: string
  workaround?: string
}

interface KnownIssuesPanelProps {
  knownIssues?: KnownIssue[]
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
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {knownIssues.map((issue, idx) => (
            <Card key={idx} className="bg-muted/50">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <Badge variant="outline" className="shrink-0">
                    {issue.status}
                  </Badge>
                  <div className="flex-1">
                    <p className="text-sm font-medium mb-2">{issue.description}</p>
                    {issue.workaround && (
                      <div className="text-xs text-muted-foreground bg-background p-2 rounded border">
                        <span className="font-semibold">Workaround:</span> {issue.workaround}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
