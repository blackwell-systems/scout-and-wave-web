import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

interface PostMergeChecklistPanelProps {
  checklistText?: string
}

export default function PostMergeChecklistPanel({ checklistText }: PostMergeChecklistPanelProps): JSX.Element {
  if (!checklistText || checklistText.trim() === '') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Post-Merge Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No post-merge checklist</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Post-Merge Checklist</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-4 rounded border overflow-auto">
            {checklistText}
          </pre>
        </div>
      </CardContent>
    </Card>
  )
}
