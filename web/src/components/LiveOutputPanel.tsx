import { useRef, useEffect } from 'react'

interface LiveOutputPanelProps {
  status: 'idle' | 'running' | 'complete' | 'failed'
  output: string
  runningLabel: string   // e.g. '⬤ AI fixing…' or '⬤ Live output'
  doneLabel: string      // e.g. '✦ AI fix complete' or 'Test output'
  failedLabel: string    // e.g. '✦ AI fix failed' or 'Test output'
  accentColor: 'teal' | 'blue'
  onClose: () => void
  actions?: React.ReactNode  // e.g. Retry Finalization button
}

const ACCENT = {
  teal: {
    border: 'border-teal-500/30',
    bg: 'bg-teal-500/10',
    divider: 'border-teal-500/20',
    label: 'text-teal-400',
    close: 'text-teal-400/60 hover:text-teal-400',
  },
  blue: {
    border: 'border-blue-500/30',
    bg: 'bg-blue-500/10',
    divider: 'border-blue-500/20',
    label: 'text-blue-400',
    close: 'text-blue-400/60 hover:text-blue-400',
  },
}

export default function LiveOutputPanel({
  status,
  output,
  runningLabel,
  doneLabel,
  failedLabel,
  accentColor,
  onClose,
  actions,
}: LiveOutputPanelProps) {
  const preRef = useRef<HTMLPreElement>(null)
  const c = ACCENT[accentColor]

  // Auto-scroll to bottom as output streams in
  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight
    }
  })

  const headerLabel =
    status === 'running' ? runningLabel :
    status === 'failed'  ? failedLabel  :
    doneLabel

  const body =
    output || (status === 'running' ? 'Waiting for output…' : 'No output.')

  return (
    <div className={`border ${c.border} rounded-none overflow-hidden`}>
      <div className={`flex items-center justify-between px-3 py-1.5 ${c.bg} border-b ${c.divider}`}>
        <span className={`text-xs font-medium ${c.label}`}>{headerLabel}</span>
        <div className="flex items-center gap-2">
          {actions}
          <button onClick={onClose} className={`${c.close} text-xs`}>✕</button>
        </div>
      </div>
      <pre
        ref={preRef}
        className="p-3 text-xs font-mono whitespace-pre-wrap break-all overflow-y-auto max-h-64 text-foreground bg-background"
      >
        {body}
      </pre>
    </div>
  )
}
