import React from 'react'
import { ChevronDown, Search, Settings } from 'lucide-react'
import DarkModeToggle from '../DarkModeToggle'
import ThemePicker from '../ThemePicker'

export interface AppHeaderProps {
  onPipelineClick: () => void
  onNewPlanClick: () => void
  onProgramsClick: () => void
  onNewProgramClick: () => void
  onSearchClick: () => void
  onSettingsClick: () => void
  onModelsClick: () => void
  showPipeline: boolean
  showPrograms: boolean
  sseConnected: boolean
  modelPickerOpen: boolean
  modelPickerContent: React.ReactNode
}

export function AppHeader(props: AppHeaderProps): JSX.Element {
  const {
    onPipelineClick,
    onNewPlanClick,
    onProgramsClick,
    onNewProgramClick,
    onSearchClick,
    onSettingsClick,
    onModelsClick,
    showPipeline,
    showPrograms,
    sseConnected,
    modelPickerOpen,
    modelPickerContent,
  } = props

  return (
    <header className="flex items-stretch justify-between h-[61px] border-b shrink-0">
      <div className="flex items-stretch">
        <button
          onClick={onPipelineClick}
          className={`flex items-center justify-center text-sm font-medium px-6 transition-colors border-r ${showPipeline ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800' : 'bg-emerald-50/40 hover:bg-emerald-100/60 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:hover:bg-emerald-900/40 dark:text-emerald-500 dark:border-emerald-900'}`}
        >
          Pipeline
        </button>
        <button
          onClick={onNewPlanClick}
          className="flex items-center justify-center text-sm font-medium px-6 transition-colors border-r bg-emerald-50/20 hover:bg-emerald-50/50 text-emerald-500 border-emerald-100 dark:bg-emerald-950/10 dark:hover:bg-emerald-900/20 dark:text-emerald-600 dark:border-emerald-900/50"
        >
          New Plan
        </button>
        <button
          onClick={onProgramsClick}
          className={`flex items-center justify-center text-sm font-medium px-6 transition-colors border-r ${showPrograms ? 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950/60 dark:text-violet-400 dark:border-violet-800' : 'bg-violet-50/40 hover:bg-violet-100/60 text-violet-700 border-violet-200 dark:bg-violet-950/20 dark:hover:bg-violet-900/40 dark:text-violet-500 dark:border-violet-900'}`}
        >
          Programs
        </button>
        <button
          onClick={onNewProgramClick}
          className="flex items-center justify-center text-sm font-medium px-6 transition-colors border-r bg-violet-50/20 hover:bg-violet-50/50 text-violet-400 border-violet-100 dark:bg-violet-950/10 dark:hover:bg-violet-900/20 dark:text-violet-500 dark:border-violet-900/50"
        >
          New Program
        </button>
        <button
          onClick={onSearchClick}
          className="flex items-center gap-2 px-4 text-xs text-muted-foreground border-r border-border hover:bg-muted hover:text-foreground transition-colors"
          title="Search plans (⌘K)"
        >
          <Search size={13} />
          <kbd className="font-mono text-[10px] hidden sm:inline">⌘K</kbd>
        </button>
      </div>
      <div className="flex items-stretch">
        {/* Single Models button */}
        <div className="relative flex items-stretch border-r border-border">
          <button
            title="Configure agent models"
            onClick={onModelsClick}
            className="flex items-center gap-2 px-4 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <span className="text-sm font-medium">Models</span>
            <ChevronDown size={12} className={`transition-transform ${modelPickerOpen ? 'rotate-180' : ''}`} />
          </button>
          {modelPickerContent}
        </div>
        <ThemePicker />
        <DarkModeToggle />
        <button onClick={onSettingsClick} title="Settings" className="flex items-center justify-center px-4 border-l border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <Settings size={16} />
        </button>
        <div
          title={sseConnected ? 'Live updates connected' : 'Live updates disconnected'}
          className={`flex items-center justify-center px-3 border-l border-border`}
        >
          <span className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]' : 'bg-muted-foreground/40'}`} />
        </div>
      </div>
    </header>
  )
}
