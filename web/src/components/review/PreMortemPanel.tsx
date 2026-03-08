import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { PreMortem } from '../../types'

interface PreMortemPanelProps {
  preMortem: PreMortem | undefined
}

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/20',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20',
  high: 'bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/20',
}

function RiskBadge({ risk }: { risk: string }) {
  const key = risk.toLowerCase().trim()
  const colors = RISK_COLORS[key] || 'bg-muted text-muted-foreground border border-border'
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${colors}`}>
      {risk}
    </span>
  )
}

export default function PreMortemPanel({ preMortem }: PreMortemPanelProps): JSX.Element {
  if (!preMortem || preMortem.rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pre-Mortem</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No pre-mortem recorded</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>Pre-Mortem</CardTitle>
          <RiskBadge risk={preMortem.overall_risk} />
        </div>
        <p className="text-xs text-muted-foreground">
          {preMortem.rows.length} scenario{preMortem.rows.length !== 1 ? 's' : ''}
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left pb-2 pr-4 font-semibold text-foreground/70">Scenario</th>
                <th className="text-left pb-2 pr-4 font-semibold text-foreground/70">Likelihood</th>
                <th className="text-left pb-2 pr-4 font-semibold text-foreground/70">Impact</th>
                <th className="text-left pb-2 font-semibold text-foreground/70">Mitigation</th>
              </tr>
            </thead>
            <tbody>
              {preMortem.rows.map((row, idx) => (
                <tr key={idx} className="border-b border-border/30 last:border-0">
                  <td className="py-2 pr-4 text-foreground">{row.scenario}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{row.likelihood}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{row.impact}</td>
                  <td className="py-2 text-muted-foreground">{row.mitigation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
