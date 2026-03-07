import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'

interface ScaffoldDetail {
  file_path: string
  contents: string
  import_path: string
}

interface ScaffoldsPanelProps {
  scaffoldsDetail?: ScaffoldDetail[]
}

export default function ScaffoldsPanel({ scaffoldsDetail }: ScaffoldsPanelProps): JSX.Element {
  if (!scaffoldsDetail || scaffoldsDetail.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Scaffolds</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No scaffolds needed</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scaffolds</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File Path</TableHead>
              <TableHead>Contents</TableHead>
              <TableHead>Import Path</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scaffoldsDetail.map((scaffold, idx) => (
              <TableRow key={idx}>
                <TableCell className="font-mono text-xs">{scaffold.file_path}</TableCell>
                <TableCell className="max-w-md">
                  <pre className="text-xs whitespace-pre-wrap font-mono overflow-auto max-h-32">
                    {scaffold.contents}
                  </pre>
                </TableCell>
                <TableCell className="font-mono text-xs">{scaffold.import_path}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
