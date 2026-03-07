import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import MarkdownContent from './MarkdownContent'

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
        <MarkdownContent>{contractsText}</MarkdownContent>
      </CardContent>
    </Card>
  )
}
