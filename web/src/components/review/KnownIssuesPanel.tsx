import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import MarkdownContent from './MarkdownContent'

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
                <MarkdownContent>{issue.description}</MarkdownContent>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
