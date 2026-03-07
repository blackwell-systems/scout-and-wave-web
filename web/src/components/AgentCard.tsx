import { AgentStatus } from '../types'

interface AgentCardProps {
  agent: AgentStatus
}

const statusStyles: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  running: 'bg-blue-100 text-blue-700',
  complete: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  complete: 'Complete',
  failed: 'Failed',
}

export default function AgentCard({ agent }: AgentCardProps) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-900 shadow-sm min-w-[200px] max-w-xs">
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold text-gray-800 dark:text-gray-100 text-sm truncate mr-2">{agent.agent}</span>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${statusStyles[agent.status] ?? statusStyles.pending} ${agent.status === 'running' ? 'animate-pulse' : ''}`}
        >
          {statusLabels[agent.status] ?? agent.status}
        </span>
      </div>

      {agent.files.length > 0 && (
        <ul className="space-y-0.5 mb-2">
          {agent.files.map(f => (
            <li key={f} className="font-mono text-xs text-gray-500 dark:text-gray-400 truncate" title={f}>
              {f}
            </li>
          ))}
        </ul>
      )}

      {agent.status === 'failed' && (
        <div className="mt-2 space-y-1">
          {agent.failure_type && (
            <span className="inline-block bg-red-50 border border-red-200 text-red-600 text-xs font-medium px-2 py-0.5 rounded">
              {agent.failure_type}
            </span>
          )}
          {agent.message && (
            <p className="text-xs text-red-600 break-words">{agent.message}</p>
          )}
        </div>
      )}
    </div>
  )
}
