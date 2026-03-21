// ProgramList — left-sidebar list of discovered PROGRAM manifests.
// Collapsible section shown above ImplList.

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ProgramDiscovery } from '../types/program'

const STATE_COLORS: Record<string, string> = {
  COMPLETE:       'bg-green-500',
  TIER_EXECUTING: 'bg-blue-500 animate-pulse',
  REVIEWED:       'bg-yellow-400',
  SCAFFOLD:       'bg-purple-400',
  BLOCKED:        'bg-red-500',
  NOT_SUITABLE:   'bg-gray-400',
}

const STATE_LABEL: Record<string, string> = {
  COMPLETE:       'Complete',
  TIER_EXECUTING: 'Executing',
  REVIEWED:       'Reviewed',
  SCAFFOLD:       'Scaffold',
  BLOCKED:        'Blocked',
  NOT_SUITABLE:   'Not Suitable',
}

interface ProgramListProps {
  programs: ProgramDiscovery[]
  selectedSlug: string | null
  onSelect: (slug: string) => void
}

export default function ProgramList({ programs, selectedSlug, onSelect }: ProgramListProps): JSX.Element {
  const [expanded, setExpanded] = useState(true)

  if (programs.length === 0) return <></>

  return (
    <div className="flex flex-col gap-0.5 px-2 pt-2 pb-1">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1.5 px-2 py-1 group"
      >
        <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium group-hover:text-muted-foreground transition-colors">
          Programs ({programs.length})
        </span>
      </button>
      {expanded && programs.map((p) => {
        const isSelected = p.slug === selectedSlug
        const dotColor = STATE_COLORS[p.state] ?? 'bg-gray-400'
        const stateLabel = STATE_LABEL[p.state] ?? p.state

        return (
          <button
            key={p.slug}
            onClick={() => onSelect(p.slug)}
            className={`w-full text-left px-2 py-2 rounded text-xs transition-colors flex flex-col gap-1 ${
              isSelected
                ? 'bg-violet-100 dark:bg-violet-950/60 text-violet-900 dark:text-violet-200'
                : 'hover:bg-muted text-foreground'
            }`}
          >
            <span className="font-medium truncate leading-tight">{p.title || p.slug}</span>
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
              {stateLabel}
            </span>
          </button>
        )
      })}
    </div>
  )
}
