import { FileOwnershipEntry } from '../types'

interface FileOwnershipTableProps {
  fileOwnership: FileOwnershipEntry[]
  col4Name?: string // detected 4th column header (e.g. "Action", "Depends On")
}

const ROW_COLORS = [
  { bg: 'bg-blue-100 dark:bg-blue-950', text: 'text-gray-800 dark:text-blue-200' },
  { bg: 'bg-purple-100 dark:bg-purple-950', text: 'text-gray-800 dark:text-purple-200' },
  { bg: 'bg-orange-100 dark:bg-orange-950', text: 'text-gray-800 dark:text-orange-200' },
  { bg: 'bg-teal-100 dark:bg-teal-950', text: 'text-gray-800 dark:text-teal-200' },
  { bg: 'bg-pink-100 dark:bg-pink-950', text: 'text-gray-800 dark:text-pink-200' },
]

function getAgentColor(agentIndex: number): { bg: string; text: string } {
  return ROW_COLORS[agentIndex % ROW_COLORS.length]
}

export default function FileOwnershipTable({ fileOwnership, col4Name }: FileOwnershipTableProps): JSX.Element {
  const agents = Array.from(new Set(fileOwnership.map(e => e.agent))).sort()
  const agentColorMap = new Map(agents.map((agent, i) => [agent, getAgentColor(i)]))

  const hasWaves = fileOwnership.some(e => e.wave > 0)

  // Determine 4th column: use detected header name, show if any row has data
  const isCol4DependsOn = col4Name ? col4Name.toLowerCase().includes('depends') : false
  const col4Label = col4Name || 'Action'
  const hasCol4 = fileOwnership.some(e =>
    isCol4DependsOn
      ? e.depends_on && e.depends_on !== ''
      : e.action && e.action !== 'unknown'
  )

  const sorted = [...fileOwnership].sort((a, b) => {
    // Scaffold always first (wave 0 or empty wave)
    const isAScaffold = a.agent.toLowerCase() === 'scaffold'
    const isBScaffold = b.agent.toLowerCase() === 'scaffold'
    if (isAScaffold && !isBScaffold) return -1
    if (!isAScaffold && isBScaffold) return 1

    // Then by wave number (treat missing wave as 0)
    const waveA = a.wave || 0
    const waveB = b.wave || 0
    if (waveA !== waveB) return waveA - waveB

    // Then by agent letter
    if (a.agent < b.agent) return -1
    if (a.agent > b.agent) return 1
    return 0
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
              {hasCol4 && <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">{col4Label}</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry, idx) => {
              const colors = agentColorMap.get(entry.agent) ?? { bg: 'bg-white dark:bg-gray-900', text: 'text-gray-800 dark:text-gray-100' }
              return (
                <tr key={idx} className={`${colors.bg} border-b border-gray-100 dark:border-gray-800 last:border-0`}>
                  <td className={`px-4 py-2 font-mono text-xs ${colors.text}`}>{entry.file}</td>
                  <td className={`px-4 py-2 ${colors.text}`}>{entry.agent}</td>
                  {hasWaves && <td className={`px-4 py-2 ${colors.text}`}>{entry.wave || ''}</td>}
                  {hasCol4 && <td className={`px-4 py-2 ${colors.text} capitalize`}>{isCol4DependsOn ? (entry.depends_on || '') : (entry.action || '')}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
