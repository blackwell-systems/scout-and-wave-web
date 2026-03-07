import { IMPLDocResponse } from '../../types'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import WaveStructureDiagram from '../WaveStructureDiagram'

interface WaveStructurePanelProps {
  impl: IMPLDocResponse
}

export default function WaveStructurePanel({ impl }: WaveStructurePanelProps): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Wave Structure</CardTitle>
      </CardHeader>
      <CardContent>
        <WaveStructureDiagram waves={impl.waves} scaffold={impl.scaffold} />
      </CardContent>
    </Card>
  )
}
