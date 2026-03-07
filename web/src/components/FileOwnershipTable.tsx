import { FileOwnershipEntry } from '../types'

interface FileOwnershipTableProps {
  fileOwnership: FileOwnershipEntry[]
}

const ROW_COLORS = [
  'bg-blue-50',
  'bg-purple-50',
  'bg-orange-50',
  'bg-teal-50',
  'bg-pink-50',
]

function getAgentColor(agentIndex: number): string {
  return ROW_COLORS[agentIndex % ROW_COLORS.length]
}

export default function FileOwnershipTable({ fileOwnership }: FileOwnershipTableProps): JSX.Element {
  const agents = Array.from(new Set(fileOwnership.map(e => e.agent))).sort()
  const agentColorMap = new Map(agents.map((agent, i) => [agent, getAgentColor(i)]))

  const hasWaves = fileOwnership.some(e => e.wave > 0)
  const hasActions = fileOwnership.some(e => e.action && e.action !== 'unknown')

  const sorted = [...fileOwnership].sort((a, b) => {
    if (a.agent < b.agent) return -1
    if (a.agent > b.agent) return 1
    return a.wave - b.wave
  })

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-3">File Ownership</h2>
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">File</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Agent</th>
              {hasWaves && <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Wave</th>}
              {hasActions && <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Action</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry, idx) => {
              const rowColor = agentColorMap.get(entry.agent) ?? 'bg-white'
              return (
                <tr key={idx} className={`${rowColor} border-b border-gray-100 dark:border-gray-800 last:border-0`}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-800 dark:text-gray-100">{entry.file}</td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{entry.agent}</td>
                  {hasWaves && <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{entry.wave || ''}</td>}
                  {hasActions && <td className="px-4 py-2 text-gray-700 dark:text-gray-300 capitalize">{entry.action || ''}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
