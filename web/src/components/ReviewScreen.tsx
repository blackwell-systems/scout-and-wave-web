import { IMPLDocResponse } from '../types'
import SuitabilityBadge from './SuitabilityBadge'
import FileOwnershipTable from './FileOwnershipTable'
import WaveStructureDiagram from './WaveStructureDiagram'
import InterfaceContracts from './InterfaceContracts'
import ActionButtons from './ActionButtons'

interface ReviewScreenProps {
  slug: string
  impl: IMPLDocResponse
  onApprove: () => void
  onReject: () => void
}

export default function ReviewScreen(props: ReviewScreenProps): JSX.Element {
  const { slug, impl, onApprove, onReject } = props
  const isNotSuitable = impl.suitability.verdict === 'NOT SUITABLE'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Plan Review</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-mono">{slug}</p>
        </div>

        {/* Suitability Badge - always visible */}
        <SuitabilityBadge suitability={impl.suitability} />

        {/* Rest of content - grayed out if NOT SUITABLE */}
        <div className={isNotSuitable ? 'opacity-40 pointer-events-none' : ''}>
          <FileOwnershipTable fileOwnership={impl.file_ownership} />
          <WaveStructureDiagram waves={impl.waves} scaffold={impl.scaffold} />
          <InterfaceContracts contracts={impl.scaffold.contracts} />
        </div>

        {/* Action buttons - always interactive */}
        <ActionButtons onApprove={onApprove} onReject={onReject} />
      </div>
    </div>
  )
}
