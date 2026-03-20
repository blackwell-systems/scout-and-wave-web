import { useRef, useEffect, useState } from 'react'
import { AgentStatus } from '../types'
import { getAgentColor } from '../lib/agentColors'
import ToolFeed from './ToolFeed'

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
        borderColor: 'rgba(63, 185, 80, 0.5)',
        boxShadow: '0 0 4px rgba(63, 185, 80, 0.12)',
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

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

export default function AgentCard({ agent }: AgentCardProps) {
  const preRef = useRef<HTMLPreElement>(null)
  const [outputExpanded, setOutputExpanded] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (agent.status !== 'running' || !agent.startedAt) return
    setElapsed(Date.now() - agent.startedAt)
    const t = setInterval(() => setElapsed(Date.now() - agent.startedAt!), 1000)
    return () => clearInterval(t)
  }, [agent.status, agent.startedAt])

  useEffect(() => {
    if (!outputExpanded && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [agent.output, outputExpanded])

  const agentOutput: string | undefined = agent.output
  const showOutput = (agent.status === 'running' || agent.status === 'complete') && agentOutput && agentOutput.length > 0
  const showToolFeed = (agent.status === 'running' || agent.status === 'complete') && (agent.toolCalls?.length ?? 0) > 0

  const agentColor = getAgentColor(agent.agent)
  const branchName = agent.branch || `wave${agent.wave}-agent-${agent.agent.toLowerCase()}`
  const statusStyle = getStatusStyle(agent.status)

  return (
    <div
      className="flex flex-col w-full overflow-hidden transition-all duration-200"
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
            <div className="flex flex-col">
              <div className="text-xs font-medium text-white/90">{statusLabels[agent.status] ?? agent.status}</div>
              {agent.taskSummary && (
                <div className="text-[10px] text-white/60 mt-0.5 leading-tight max-w-[180px] truncate">
                  {agent.taskSummary}
                </div>
              )}
            </div>
          </div>
          {agent.status === 'running' && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-blue-300/70">{formatElapsed(elapsed)}</span>
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.2s' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.4s' }} />
              </div>
            </div>
          )}
        </div>
        <div className="text-[10px] font-mono text-white/50">{branchName}</div>
      </div>

      {/* Output section */}
      {showOutput && (
        <div className="p-3">
          {agentOutput.length > 200 && (
            <button
              onClick={() => setOutputExpanded(prev => !prev)}
              className="text-xs text-white/50 hover:text-white/80 cursor-pointer mb-1 block"
            >
              {outputExpanded ? '▲ Show less' : '▼ Show more'}
            </button>
          )}
          <pre
            ref={preRef}
            className={`text-xs font-mono text-white/70 bg-black/30 rounded p-2 overflow-y-auto whitespace-pre-wrap break-all ${outputExpanded ? 'max-h-96' : 'max-h-32'}`}
          >
            {agentOutput}
          </pre>
        </div>
      )}

      {/* Tool feed */}
      {showToolFeed && <ToolFeed calls={agent.toolCalls!} />}

      {/* Files and errors */}
      {((agent.files?.length ?? 0) > 0 || agent.status === 'failed') && (
        <div className="p-3 pt-0">
          {(agent.files?.length ?? 0) > 0 && (
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
