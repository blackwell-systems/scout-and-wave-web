import { ToolCallEntry } from '../types'

interface ToolFeedProps {
  calls: ToolCallEntry[]   // ordered newest-first, already capped at 50
}

// Tool color mapping — explicit classes for Tailwind JIT
const toolColors: Record<string, { bg: string; text: string; border: string }> = {
  Read: { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/50' },
  Write: { bg: 'bg-amber-500/20', text: 'text-amber-300', border: 'border-amber-500/50' },
  Edit: { bg: 'bg-violet-500/20', text: 'text-violet-300', border: 'border-violet-500/50' },
  Bash: { bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/50' },
  Glob: { bg: 'bg-gray-500/20', text: 'text-gray-300', border: 'border-gray-500/50' },
  Grep: { bg: 'bg-gray-500/20', text: 'text-gray-300', border: 'border-gray-500/50' },
}

function getToolColor(toolName: string): { bg: string; text: string; border: string } {
  return toolColors[toolName] ?? { bg: 'bg-gray-500/20', text: 'text-gray-300', border: 'border-gray-500/50' }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + '…'
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export default function ToolFeed({ calls }: ToolFeedProps) {
  if (calls.length === 0) return null

  return (
    <div className="max-h-40 overflow-y-auto space-y-1 px-3 pb-3">
      {calls.map(call => {
        const colors = getToolColor(call.tool_name)
        return (
          <div
            key={call.tool_id}
            className={`flex items-center gap-2 px-2 py-1 rounded text-xs border ${colors.bg} ${colors.border} ${call.status === 'error' ? 'bg-red-500/10 border-red-500/50' : ''}`}
          >
            {/* Tool name badge */}
            <span className={`font-semibold ${colors.text} min-w-[48px]`}>
              {call.tool_name}
            </span>

            {/* Input (truncated) */}
            <span className="font-mono text-white/60 truncate flex-1">
              {truncate(call.input, 60)}
            </span>

            {/* Status indicator */}
            {call.status === 'running' && (
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.2s' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.4s' }} />
              </div>
            )}

            {/* Duration badge */}
            {(call.status === 'done' || call.status === 'error') && call.duration_ms !== undefined && (
              <span className={`font-mono ${call.status === 'error' ? 'text-red-400' : 'text-white/50'} min-w-[48px] text-right`}>
                {formatDuration(call.duration_ms)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
