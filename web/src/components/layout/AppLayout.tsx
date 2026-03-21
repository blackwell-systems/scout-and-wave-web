import React, { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export interface AppLayoutProps {
  sidebar: React.ReactNode
  header: React.ReactNode
  main: React.ReactNode
  rightPanel?: React.ReactNode
  rightPanelWidth?: number
  onRightPanelResize?: (width: number) => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  sidebarWidth?: number
  sidebarDividerProps?: Record<string, any>
  rightPanelCollapsed?: boolean
  onToggleRightPanel?: () => void
  rightPanelCollapsedContent?: React.ReactNode
}

export function AppLayout(props: AppLayoutProps): JSX.Element {
  const {
    sidebar,
    header,
    main,
    rightPanel,
    rightPanelWidth,
    onRightPanelResize,
    sidebarCollapsed = false,
    onToggleSidebar,
    sidebarWidth,
    sidebarDividerProps,
    rightPanelCollapsed = false,
    onToggleRightPanel,
    rightPanelCollapsedContent,
  } = props

  const draggingRight = useRef(false)

  const rightDividerMouseDown = (e: React.MouseEvent) => {
    if (!onRightPanelResize) return
    e.preventDefault()
    draggingRight.current = true
    const onMove = (mv: MouseEvent) => {
      onRightPanelResize(Math.max(240, Math.min(window.innerWidth - mv.clientX, window.innerWidth * 0.30)))
    }
    const onUp = () => {
      draggingRight.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {header}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar — single container, animated width */}
        <div
          className={`shrink-0 flex flex-col border-r bg-muted overflow-hidden transition-[width] duration-200 ease-in-out ${sidebarCollapsed ? 'cursor-pointer hover:bg-muted/60' : ''}`}
          style={{ width: sidebarCollapsed ? 40 : sidebarWidth }}
          onClick={sidebarCollapsed ? onToggleSidebar : undefined}
          title={sidebarCollapsed ? 'Expand sidebar' : undefined}
        >
          <div
            onClick={!sidebarCollapsed ? onToggleSidebar : undefined}
            className={`flex items-center border-b border-border px-2 py-1.5 text-muted-foreground shrink-0 ${!sidebarCollapsed ? 'cursor-pointer hover:text-foreground hover:bg-muted/80 transition-colors' : ''}`}
            title={!sidebarCollapsed ? 'Collapse sidebar' : undefined}
          >
            {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </div>
          {!sidebarCollapsed && (
            <div className="flex flex-col overflow-y-auto flex-1">
              {sidebar}
            </div>
          )}
        </div>
        {!sidebarCollapsed && sidebarDividerProps && <div {...sidebarDividerProps} />}

        {/* Center column */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {main}
        </div>

        {/* Right divider + rail — only when rightPanel is provided and not collapsed */}
        {rightPanel != null && !rightPanelCollapsed && (
          <div
            onMouseDown={rightDividerMouseDown}
            style={{ width: '4px', flexShrink: 0, alignSelf: 'stretch' }}
            className="cursor-col-resize select-none bg-border hover:bg-primary/30 transition-colors"
          />
        )}
        {rightPanelCollapsed && rightPanelCollapsedContent != null ? (
          <div
            className="shrink-0 border-l border-border flex flex-col overflow-hidden transition-[width] duration-200 ease-in-out cursor-pointer"
            style={{ width: 40 }}
            onClick={onToggleRightPanel}
          >
            {rightPanelCollapsedContent}
          </div>
        ) : rightPanel != null ? (
          <div className="shrink-0 overflow-hidden border-l transition-[width] duration-200 ease-in-out" style={{ width: rightPanelWidth }}>
            {rightPanel}
          </div>
        ) : null}
      </div>
    </div>
  )
}
