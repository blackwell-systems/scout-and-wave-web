import { useState, useEffect, useRef } from 'react'
import { Search, Settings } from 'lucide-react'
import DarkModeToggle from '../DarkModeToggle'
import HighContrastToggle from '../HighContrastToggle'
import ThemePicker from '../ThemePicker'
import ModelPicker from '../ModelPicker'
import { ModelRole, MODEL_ROLES } from '../../types/models'

function NavTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="group/tip relative flex items-stretch">
      {children}
      <div className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 delay-300">
        <div className="whitespace-nowrap rounded bg-foreground text-background px-2 py-1 text-[11px] shadow-lg">
          {label}
        </div>
      </div>
    </div>
  )
}

export interface AppHeaderProps {
  onNewPlanClick: () => void
  onProgramsClick: () => void
  onNewProgramClick: () => void
  onSearchClick: () => void
  onSettingsClick: () => void
  showPrograms: boolean
  sseConnected: boolean
  models: Record<ModelRole, string>
  onModelChange: (role: ModelRole, value: string) => void
}

const ROLE_COLORS: Record<ModelRole, string> = {
  scout: 'text-amber-600 dark:text-amber-400',
  critic: 'text-orange-600 dark:text-orange-400',
  wave: 'text-blue-600 dark:text-blue-400',
  chat: 'text-violet-600 dark:text-violet-400',
  planner: 'text-emerald-600 dark:text-emerald-400',
  scaffold: 'text-cyan-600 dark:text-cyan-400',
  integration: 'text-rose-600 dark:text-rose-400',
}


function shortModel(value: string): string {
  // Strip provider prefix and shorten model name for display
  const model = value.includes(':') ? value.split(':', 2)[1] : value
  return model
    .replace('claude-', '')
    .replace('-20251001', '')
    .replace('-latest', '')
}

export function AppHeader(props: AppHeaderProps): JSX.Element {
  const {
    onNewPlanClick,
    onProgramsClick,
    onNewProgramClick,
    onSearchClick,
    onSettingsClick,
    showPrograms,
    sseConnected,
    models,
    onModelChange,
  } = props

  const [openRole, setOpenRole] = useState<ModelRole | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openRole) return
    function handleClick(e: MouseEvent) {
      if (openRole && pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setOpenRole(null)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpenRole(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [openRole])

  return (
    <header className="flex items-stretch justify-between h-[61px] border-b shrink-0">
      <div className="flex items-stretch">
        <NavTip label="View all plans and programs">
          <button
            onClick={onProgramsClick}
            className={`flex items-center justify-center text-sm font-medium px-6 transition-colors border-r ${showPrograms ? 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/60 dark:text-violet-400 dark:border-violet-800' : 'bg-violet-50/40 hover:bg-violet-100/60 text-violet-700 border-violet-200 dark:bg-violet-950/20 dark:hover:bg-violet-900/40 dark:text-violet-500 dark:border-violet-900'}`}
          >
            Home
          </button>
        </NavTip>
        <NavTip label="Create a new Scout plan">
          <button
            onClick={onNewPlanClick}
            className="flex items-center justify-center text-sm font-medium px-6 transition-colors border-r bg-emerald-50/20 hover:bg-emerald-50/50 text-emerald-500 border-emerald-100 dark:bg-emerald-950/10 dark:hover:bg-emerald-900/20 dark:text-emerald-600 dark:border-emerald-900/50"
          >
            New Plan
          </button>
        </NavTip>
        <NavTip label="Create a multi-IMPL program">
          <button
            onClick={onNewProgramClick}
            className="flex items-center justify-center text-sm font-medium px-6 transition-colors border-r bg-violet-50/20 hover:bg-violet-50/50 text-violet-400 border-violet-100 dark:bg-violet-950/10 dark:hover:bg-violet-900/20 dark:text-violet-500 dark:border-violet-900/50"
          >
            New Program
          </button>
        </NavTip>
        <NavTip label="Search plans (⌘K)">
          <button
            onClick={onSearchClick}
            className="flex items-center gap-2 px-4 text-xs text-muted-foreground border-r border-border hover:bg-muted hover:text-foreground transition-colors"
          >
            <Search size={13} />
            <kbd className="font-mono text-[10px] hidden sm:inline">⌘K</kbd>
          </button>
        </NavTip>
      </div>
      <div className="flex items-stretch">
        {/* Individual model role buttons */}
        {MODEL_ROLES.map(role => (
          <div key={role} ref={openRole === role ? pickerRef : undefined} className="relative flex items-stretch border-r border-border">
            <button
              onClick={() => setOpenRole(openRole === role ? null : role)}
              className="flex items-center gap-2 px-3 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors group"
            >
              <span className={`text-[10px] uppercase tracking-wider font-semibold ${ROLE_COLORS[role]}`}>{role}</span>
              <span className="text-xs font-mono truncate max-w-[120px]">{shortModel(models[role])}</span>
            </button>
            {openRole === role && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpenRole(null)} />
                <div className="absolute top-full right-0 mt-2 z-50 bg-popover border border-border rounded-lg shadow-2xl p-4 w-[480px] animate-in fade-in slide-in-from-top-2 duration-200">
                  <ModelPicker
                    id={`header-${role}-model`}
                    label={`${role.charAt(0).toUpperCase() + role.slice(1)} Model`}
                    value={models[role]}
                    onChange={value => {
                      onModelChange(role, value)
                      setOpenRole(null)
                    }}
                  />
                </div>
              </>
            )}
          </div>
        ))}
        <NavTip label="Color theme">
          <ThemePicker />
        </NavTip>
        <NavTip label="Toggle dark mode">
          <DarkModeToggle />
        </NavTip>
        <NavTip label="Toggle high contrast">
          <HighContrastToggle />
        </NavTip>
        <NavTip label="Settings">
          <button onClick={onSettingsClick} className="flex items-center justify-center px-4 border-l border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <Settings size={16} />
          </button>
        </NavTip>
        <NavTip label={sseConnected ? 'Live updates connected' : 'Disconnected'}>
          <div className={`flex items-center justify-center px-3 border-l border-border`}>
            <span className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]' : 'bg-muted-foreground/40'}`} />
          </div>
        </NavTip>
      </div>
    </header>
  )
}
