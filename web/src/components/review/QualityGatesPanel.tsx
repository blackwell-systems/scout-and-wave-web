import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

interface Gate {
  command: string
  required: boolean
  description: string
}

function parseGates(text: string): Gate[] {
  const gates: Gate[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('- ') && !trimmed.startsWith('* ')) continue
    const content = trimmed.slice(2).trim()
    if (!content) continue

    const requiredTag = /\[required\]/i.test(content)
    const optionalTag = /\[optional\]/i.test(content)
    const required = requiredTag || !optionalTag

    // Strip tags from content to get the raw gate line
    const stripped = content.replace(/\[(required|optional)\]/gi, '').trim()

    // Split on first ' — ' or ' - ' to get command vs description
    const dashIdx = stripped.search(/ [—–-] /)
    let command: string
    let description: string
    if (dashIdx !== -1) {
      command = stripped.slice(0, dashIdx).trim()
      description = stripped.slice(dashIdx).replace(/^ [—–-] /, '').trim()
    } else {
      command = stripped
      description = ''
    }

    gates.push({ command, required, description })
  }
  return gates
}

export default function QualityGatesPanel({ gatesText }: { gatesText?: string }): JSX.Element {
  if (!gatesText || gatesText.trim() === '') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Quality Gates</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No quality gates defined</p>
        </CardContent>
      </Card>
    )
  }

  const gates = parseGates(gatesText)

  if (gates.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Quality Gates</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No quality gates defined</p>
        </CardContent>
      </Card>
    )
  }

  const requiredCount = gates.filter(g => g.required).length
  const optionalCount = gates.length - requiredCount

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quality Gates</CardTitle>
        <p className="text-xs text-muted-foreground">
          {requiredCount} required{optionalCount > 0 ? `, ${optionalCount} optional` : ''}
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left py-2 pr-4 font-semibold text-foreground/70">Command</th>
                <th className="text-left py-2 pr-4 font-semibold text-foreground/70 whitespace-nowrap">Required?</th>
                <th className="text-left py-2 font-semibold text-foreground/70">Description</th>
              </tr>
            </thead>
            <tbody>
              {gates.map((gate, idx) => (
                <tr key={idx} className="border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="py-2 pr-4 align-top">
                    <code className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded text-foreground">
                      {gate.command}
                    </code>
                  </td>
                  <td className="py-2 pr-4 align-top whitespace-nowrap">
                    {gate.required ? (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/20">
                        required
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                        optional
                      </span>
                    )}
                  </td>
                  <td className="py-2 align-top text-muted-foreground leading-relaxed">
                    {gate.description || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
