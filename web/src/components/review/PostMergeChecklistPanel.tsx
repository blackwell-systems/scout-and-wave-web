import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import MarkdownContent from './MarkdownContent'

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
        <MarkdownContent>{checklistText}</MarkdownContent>
      </CardContent>
    </Card>
  )
}
