import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

interface InterfaceContractsPanelProps {
  contractsText?: string
}

export default function InterfaceContractsPanel({ contractsText }: InterfaceContractsPanelProps): JSX.Element {
  if (!contractsText || contractsText.trim() === '') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Interface Contracts</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No interface contracts defined</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Interface Contracts</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-4 rounded border overflow-auto">
            {contractsText}
          </pre>
        </div>
      </CardContent>
    </Card>
  )
}
