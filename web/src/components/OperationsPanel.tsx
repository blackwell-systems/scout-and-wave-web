import { useState } from 'react'
import { PanelRightOpen, PanelRightClose, ListOrdered, Bot, Settings } from 'lucide-react'
import QueuePanel from './QueuePanel'
import DaemonControl from './DaemonControl'
import AutonomySettings from './AutonomySettings'

interface OperationsPanelProps {
  onSelectItem?: (slug: string) => void
}

type SideTab = 'queue' | 'daemon' | 'settings'

const tabConfig: readonly { key: SideTab; label: string; icon: typeof ListOrdered }[] = [
  { key: 'queue', label: 'Queue', icon: ListOrdered },
  { key: 'daemon', label: 'Daemon', icon: Bot },
  { key: 'settings', label: 'Settings', icon: Settings },
] as const

/**
 * Collapsible panel containing Queue, Daemon, and Autonomy Settings tabs.
 * Extracted from PipelineView's right sidebar for use in the unified programs view.
 */
export default function OperationsPanel({ onSelectItem }: OperationsPanelProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [sideTab, setSideTab] = useState<SideTab>('queue')

  if (collapsed) {
    return (
      <div className="w-10 shrink-0 border-l border-border flex flex-col items-center py-2 gap-2 bg-muted/20">
        <button
          onClick={() => setCollapsed(false)}
          className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Expand operations panel"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>
        {tabConfig.map(({ key, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { setSideTab(key); setCollapsed(false) }}
            className={`p-1.5 transition-colors ${
              sideTab === key
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            aria-label={key}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="w-[320px] shrink-0 border-l border-border flex flex-col">
      {/* Tabs header with collapse toggle */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setCollapsed(true)}
          className="px-2 text-muted-foreground hover:text-foreground transition-colors border-r border-border"
          aria-label="Collapse operations panel"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
        {tabConfig.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSideTab(key)}
            className={`flex-1 text-xs font-medium py-2.5 transition-colors ${
              sideTab === key
                ? 'text-foreground border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {sideTab === 'queue' && <QueuePanel onSelectItem={onSelectItem} />}
        {sideTab === 'daemon' && <DaemonControl />}
        {sideTab === 'settings' && <AutonomySettings />}
      </div>
    </div>
  )
}
