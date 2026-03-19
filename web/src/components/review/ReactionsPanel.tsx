import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { ReactionsConfig } from '../../types'

interface ReactionsPanelProps {
  reactions: ReactionsConfig | undefined
}

// Display order for failure types
const FAILURE_TYPE_ORDER: ReadonlyArray<keyof ReactionsConfig> = ['transient', 'timeout', 'fixable', 'needs_replan', 'escalate']

// Human-readable labels
const FAILURE_TYPE_LABELS: Record<string, string> = {
  transient:    'Transient',
  timeout:      'Timeout',
  fixable:      'Fixable',
  needs_replan: 'Needs Replan',
  escalate:     'Escalate',
}

// Action badge colors (Tailwind bg- classes consistent with existing badges)
const ACTION_COLORS: Record<string, string> = {
  'retry':           'bg-blue-500/20 text-blue-300',
  'send-fix-prompt': 'bg-yellow-500/20 text-yellow-300',
  'pause':           'bg-orange-500/20 text-orange-300',
  'auto-scout':      'bg-purple-500/20 text-purple-300',
}

export default function ReactionsPanel({ reactions }: ReactionsPanelProps): JSX.Element | null {
  if (!reactions) return null
  const hasAny = FAILURE_TYPE_ORDER.some(k => reactions[k])
  if (!hasAny) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reactions Config</CardTitle>
        <p className="text-xs text-muted-foreground">
          Per-failure-type routing overrides (E19.1)
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60">
                <th className="text-left pb-2 pr-4 font-semibold text-foreground/70">Failure Type</th>
                <th className="text-left pb-2 pr-4 font-semibold text-foreground/70">Action</th>
                <th className="text-left pb-2 font-semibold text-foreground/70">Max Attempts</th>
              </tr>
            </thead>
            <tbody>
              {FAILURE_TYPE_ORDER.map(k => {
                const entry = reactions[k as keyof ReactionsConfig]
                if (!entry) return null
                const actionColor = ACTION_COLORS[entry.action] || 'bg-muted text-muted-foreground'
                return (
                  <tr key={k} className="border-b border-border/30 last:border-0">
                    <td className="py-2 pr-4 text-foreground">{FAILURE_TYPE_LABELS[k] ?? k}</td>
                    <td className="py-2 pr-4">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${actionColor}`}>
                        {entry.action}
                      </span>
                    </td>
                    <td className="py-2">
                      {entry.max_attempts ? (
                        <span className="text-foreground">{entry.max_attempts}</span>
                      ) : (
                        <span className="text-muted-foreground">default</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
