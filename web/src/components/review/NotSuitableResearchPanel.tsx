import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { IMPLDocResponse } from '../../types'
import MarkdownContent from './MarkdownContent'

interface NotSuitableResearchPanelProps {
  impl: IMPLDocResponse
  onArchive: () => void
}

function parseBlockers(rationale: string): string[] {
  const blockers: string[] = []
  for (const line of rationale.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      blockers.push(trimmed.slice(2).trim())
    }
  }
  return blockers
}

export default function NotSuitableResearchPanel({ impl, onArchive }: NotSuitableResearchPanelProps): JSX.Element {
  const rationale = impl.suitability?.rationale || ''
  const blockers = parseBlockers(rationale)

  return (
    <div className="space-y-4">
      {/* NOT SUITABLE badge */}
      <div className="flex items-center gap-3 rounded-lg bg-red-500/15 border border-red-500/30 px-4 py-3">
        <span className="text-sm font-bold text-red-700 dark:text-red-400 uppercase tracking-wide">
          NOT SUITABLE
        </span>
        <span className="text-xs text-red-600 dark:text-red-400/80">
          This IMPL was marked not suitable for parallel wave implementation
        </span>
      </div>

      {/* Suitability Rationale */}
      <Card>
        <CardHeader>
          <CardTitle>Suitability Rationale</CardTitle>
        </CardHeader>
        <CardContent>
          {rationale ? (
            <div className="text-sm leading-relaxed text-foreground/80">
              <MarkdownContent>{rationale}</MarkdownContent>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No rationale provided.</p>
          )}
        </CardContent>
      </Card>

      {/* What Would Make It Suitable */}
      {blockers.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="text-amber-700 dark:text-amber-400">What Would Make It Suitable</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Resolve the following blockers to enable parallel implementation:
            </p>
            <ul className="space-y-2">
              {blockers.map((blocker, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-[10px] font-bold text-amber-700 dark:text-amber-400">
                    {idx + 1}
                  </span>
                  <span className="text-foreground/80 leading-relaxed">{blocker}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Serial Implementation Notes */}
      <Card>
        <CardHeader>
          <CardTitle>Serial Implementation Notes</CardTitle>
          <p className="text-xs text-muted-foreground">
            Dependency graph and interface contracts for sequential implementation
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {impl.dependency_graph_text ? (
            <div>
              <div className="text-xs font-semibold text-foreground/70 mb-2 pb-1 border-b border-border/50">
                Dependency Graph
              </div>
              <pre className="text-xs font-mono bg-muted/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap text-foreground/80 leading-relaxed">
                {impl.dependency_graph_text}
              </pre>
            </div>
          ) : null}

          {impl.interface_contracts_text ? (
            <div>
              <div className="text-xs font-semibold text-foreground/70 mb-2 pb-1 border-b border-border/50">
                Interface Contracts
              </div>
              <div className="text-sm leading-relaxed text-foreground/80">
                <MarkdownContent>{impl.interface_contracts_text}</MarkdownContent>
              </div>
            </div>
          ) : null}

          {!impl.dependency_graph_text && !impl.interface_contracts_text && (
            <p className="text-sm text-muted-foreground">No serial implementation notes available.</p>
          )}
        </CardContent>
      </Card>

      {/* Archive button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={onArchive}
          className="px-4 py-2 text-sm font-medium rounded-md bg-muted hover:bg-muted/80 text-foreground border border-border transition-colors"
        >
          Archive
        </button>
      </div>
    </div>
  )
}
