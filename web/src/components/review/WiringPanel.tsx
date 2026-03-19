import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { WiringEntry } from '../../types'

interface WiringPanelProps {
  wiring: WiringEntry[] | undefined
}

const STATUS_COLORS: Record<string, string> = {
  declared: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/20',
  verified: 'bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/20',
  gap: 'bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/20',
}

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] || 'bg-muted text-muted-foreground border border-border'
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${colors}`}>
      {status}
    </span>
  )
}

export default function WiringPanel({ wiring }: WiringPanelProps): JSX.Element {
  if (!wiring || wiring.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Wiring Declarations</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No wiring declarations</p>
        </CardContent>
      </Card>
    )
  }

  const gapCount = wiring.filter(w => w.status === 'gap').length

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>Wiring Declarations</CardTitle>
          {gapCount > 0 && (
            <StatusBadge status="gap" />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {wiring.length} declaration{wiring.length !== 1 ? 's' : ''}
          {gapCount > 0 ? ` — ${gapCount} gap${gapCount !== 1 ? 's' : ''} detected` : ''}
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left pb-2 pr-4 font-semibold text-foreground/70">Symbol</th>
                <th className="text-left pb-2 pr-4 font-semibold text-foreground/70">Defined In</th>
                <th className="text-left pb-2 pr-4 font-semibold text-foreground/70">Must Be Called From</th>
                <th className="text-left pb-2 pr-4 font-semibold text-foreground/70">Agent</th>
                <th className="text-left pb-2 font-semibold text-foreground/70">Status</th>
              </tr>
            </thead>
            <tbody>
              {wiring.map((w, idx) => (
                <tr key={idx} className="border-b border-border/30 last:border-0">
                  <td className="py-2 pr-4 font-mono text-foreground">{w.symbol}</td>
                  <td className="py-2 pr-4 text-muted-foreground font-mono text-[10px]">{w.defined_in}</td>
                  <td className="py-2 pr-4 text-muted-foreground font-mono text-[10px]">{w.must_be_called_from}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{w.agent}</td>
                  <td className="py-2"><StatusBadge status={w.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
