import { useState, useRef, useEffect } from 'react'

/** Scaffold card — matches AgentCard styling with streaming output. */
export default function ScaffoldCard({ status, output, error }: { status: string; output: string; error?: string }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!expanded && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [output, expanded])

  const borderStyle = status === 'complete'
    ? { borderColor: 'rgb(63, 185, 80)', boxShadow: '0 0 10px rgba(63, 185, 80, 0.3)' }
    : status === 'failed'
    ? { borderColor: 'rgb(248, 81, 73)', boxShadow: '0 0 12px rgba(248, 81, 73, 0.5)' }
    : { borderColor: 'rgb(88, 166, 255)', boxShadow: '0 0 12px rgba(88, 166, 255, 0.4)' }

  return (
    <div className="flex flex-col w-full overflow-hidden transition-all duration-200" style={{ borderRadius: '12px', border: '3px solid', ...borderStyle }}>
      <div className="flex items-center justify-between p-3 bg-black/20 dark:bg-white/5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg font-bold text-sm" style={{ backgroundColor: '#6b728020', color: '#6b7280', border: '2px solid #6b728050' }}>
            Sc
          </div>
          <div className="text-xs font-medium text-white/90">
            {status === 'complete' ? 'Complete' : status === 'failed' ? 'Failed' : 'Running'}
          </div>
        </div>
        {status === 'running' && (
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.2s' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.4s' }} />
          </div>
        )}
      </div>
      {output.length > 0 && (
        <div className="p-3">
          {output.length > 200 && (
            <button onClick={() => setExpanded(prev => !prev)} className="text-xs text-white/50 hover:text-white/80 cursor-pointer mb-1 block">
              {expanded ? '\u25B2 Show less' : '\u25BC Show more'}
            </button>
          )}
          <pre ref={preRef} className={`text-xs font-mono text-white/70 bg-black/30 rounded p-2 overflow-y-auto whitespace-pre-wrap break-all ${expanded ? 'max-h-96' : 'max-h-32'}`}>
            {output}
          </pre>
        </div>
      )}
      {status === 'failed' && error && (
        <div className="p-3 pt-0">
          <div className="text-xs text-red-400 bg-red-500/10 rounded p-2 break-words">{error}</div>
        </div>
      )}
    </div>
  )
}
