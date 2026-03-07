import { IMPLDocResponse } from '../../types'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import SuitabilityBadge from '../SuitabilityBadge'

interface OverviewPanelProps {
  impl: IMPLDocResponse
}

export default function OverviewPanel({ impl }: OverviewPanelProps): JSX.Element {
  const fileCount = impl.file_ownership.length
  const agentSet = new Set(impl.file_ownership.map(e => e.agent))
  const agentCount = agentSet.size
  const waveCount = impl.waves.length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Overview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <SuitabilityBadge suitability={impl.suitability} />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 border rounded-lg">
            <div className="text-3xl font-bold text-primary">{fileCount}</div>
            <div className="text-sm text-muted-foreground mt-1">Files</div>
          </div>
          <div className="text-center p-4 border rounded-lg">
            <div className="text-3xl font-bold text-primary">{agentCount}</div>
            <div className="text-sm text-muted-foreground mt-1">Agents</div>
          </div>
          <div className="text-center p-4 border rounded-lg">
            <div className="text-3xl font-bold text-primary">{waveCount}</div>
            <div className="text-sm text-muted-foreground mt-1">Waves</div>
          </div>
        </div>

        {impl.suitability.rationale && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold mb-2">Rationale</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {impl.suitability.rationale}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
