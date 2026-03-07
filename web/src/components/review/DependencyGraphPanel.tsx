import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

interface DependencyGraphPanelProps {
  dependencyGraphText?: string
}

export default function DependencyGraphPanel({ dependencyGraphText }: DependencyGraphPanelProps): JSX.Element {
  if (!dependencyGraphText || dependencyGraphText.trim() === '') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dependency Graph</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No dependency graph</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dependency Graph</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-4 rounded border overflow-auto">
            {dependencyGraphText}
          </pre>
        </div>
      </CardContent>
    </Card>
  )
}
