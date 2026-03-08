import { useRef, useEffect } from 'react'
import { AgentStatus } from '../types'
import { getAgentColor } from '../lib/agentColors'

interface AgentCardProps {
  agent: AgentStatus
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  complete: 'Complete',
  failed: 'Failed',
}

// Status-based styling with glowing borders (maestro-inspired)
const getStatusStyle = (status: string) => {
  switch (status) {
    case 'running':
      return {
        borderColor: 'rgb(88, 166, 255)',
        boxShadow: '0 0 12px rgba(88, 166, 255, 0.4), 0 0 24px rgba(88, 166, 255, 0.2)',
      }
    case 'complete':
      return {
        borderColor: 'rgb(63, 185, 80)',
        boxShadow: '0 0 10px rgba(63, 185, 80, 0.3), 0 0 20px rgba(63, 185, 80, 0.15)',
      }
    case 'failed':
      return {
        borderColor: 'rgb(248, 81, 73)',
        boxShadow: '0 0 12px rgba(248, 81, 73, 0.5), 0 0 24px rgba(248, 81, 73, 0.25)',
      }
    case 'pending':
    default:
      return {
        borderColor: 'rgba(140, 140, 150, 0.4)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.2)',
      }
  }
}

export default function AgentCard({ agent }: AgentCardProps) {
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [agent.output])

  const agentOutput: string | undefined = agent.output
  const showOutput = (agent.status === 'running' || agent.status === 'complete') && agentOutput && agentOutput.length > 0

  const agentColor = getAgentColor(agent.agent)
  const branchName = agent.branch || `wave${agent.wave}-agent-${agent.agent.toLowerCase()}`
  const statusStyle = getStatusStyle(agent.status)

  return (
    <div
      className="flex flex-col min-w-[240px] max-w-sm overflow-hidden transition-all duration-200"
      style={{
        borderRadius: '12px',
        border: '3px solid',
        ...statusStyle,
      }}
    >
      {/* Header with agent letter, status badge, and branch */}
      <div className="flex flex-col gap-2 p-3 bg-black/20 dark:bg-white/5 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="flex items-center justify-center w-8 h-8 rounded-lg font-bold text-sm"
              style={{
                backgroundColor: `${agentColor}20`,
                color: agentColor,
                border: `2px solid ${agentColor}50`,
              }}
            >
              {agent.agent}
            </div>
            <div className="text-xs font-medium text-white/90">{statusLabels[agent.status] ?? agent.status}</div>
          </div>
          {agent.status === 'running' && (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.2s' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.4s' }} />
            </div>
          )}
        </div>
        <div className="text-[10px] font-mono text-white/50">{branchName}</div>
      </div>

      {/* Output section */}
      {showOutput && (
        <div className="p-3">
          <pre
            ref={preRef}
            className="text-xs font-mono text-white/70 bg-black/30 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-all"
          >
            {agentOutput}
          </pre>
        </div>
      )}

      {/* Files and errors */}
      {(agent.files.length > 0 || agent.status === 'failed') && (
        <div className="p-3 pt-0">
          {agent.files.length > 0 && (
            <ul className="space-y-0.5 mb-2">
              {agent.files.map(f => (
                <li key={f} className="font-mono text-xs text-white/60 truncate" title={f}>
                  {f}
                </li>
              ))}
            </ul>
          )}

          {agent.status === 'failed' && agent.message && (
            <div className="mt-2 text-xs text-red-400 bg-red-500/10 rounded p-2 break-words">
              {agent.failure_type && <div className="font-semibold mb-1">{agent.failure_type}</div>}
              {agent.message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
