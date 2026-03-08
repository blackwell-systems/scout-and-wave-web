import { useRef, useEffect } from 'react'
import { AgentStatus } from '../types'
import { Card, CardContent, CardHeader } from './ui/card'
import { Badge } from './ui/badge'

interface AgentCardProps {
  agent: AgentStatus
}

const statusStyles: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  complete: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  complete: 'Complete',
  failed: 'Failed',
}

export default function AgentCard({ agent }: AgentCardProps) {
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  // @ts-expect-error — output added by Agent C
  }, [agent.output])

  // output field added by Agent C (parallel wave); using cast until types.ts is merged
  const agentOutput: string | undefined = (agent as any).output
  const showOutput = agent.status === 'running' && agentOutput && agentOutput.length > 0

  return (
    <Card className="min-w-[200px] max-w-xs">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <span className="font-bold text-sm truncate mr-2">{agent.agent}</span>
          <Badge
            variant="secondary"
            className={`text-xs whitespace-nowrap ${statusStyles[agent.status] ?? statusStyles.pending} ${agent.status === 'running' ? 'animate-pulse' : ''}`}
          >
            {statusLabels[agent.status] ?? agent.status}
          </Badge>
        </div>
      </CardHeader>

      {showOutput && (
        <CardContent className="pt-0">
          <pre
            ref={preRef}
            className="text-xs font-mono text-muted-foreground bg-muted/50 rounded p-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-all"
          >
            {agentOutput}
          </pre>
        </CardContent>
      )}

      {(agent.files.length > 0 || agent.status === 'failed') && (
        <CardContent className="pt-0">
          {agent.files.length > 0 && (
            <ul className="space-y-0.5 mb-2">
              {agent.files.map(f => (
                <li key={f} className="font-mono text-xs text-muted-foreground truncate" title={f}>
                  {f}
                </li>
              ))}
            </ul>
          )}

          {agent.status === 'failed' && (
            <div className="mt-2 space-y-1">
              {agent.failure_type && (
                <Badge variant="outline" className="bg-red-50 border-red-200 text-red-600 dark:bg-red-950 dark:border-red-800 dark:text-red-400">
                  {agent.failure_type}
                </Badge>
              )}
              {agent.message && (
                <p className="text-xs text-red-600 dark:text-red-400 break-words">{agent.message}</p>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
