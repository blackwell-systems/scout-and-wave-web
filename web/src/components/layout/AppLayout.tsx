import React from 'react'
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
  } = props

  const rightDividerMouseDown = (e: React.MouseEvent) => {
    if (!onRightPanelResize) return
    e.preventDefault()
    const onMove = (mv: MouseEvent) => {
      onRightPanelResize(Math.max(240, Math.min(window.innerWidth - mv.clientX, window.innerWidth * 0.30)))
    }
    const onUp = () => {
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
        {/* Left sidebar */}
        {sidebarCollapsed ? (
          <div className="relative shrink-0 border-r w-0 bg-muted">
            <button
              onClick={onToggleSidebar}
              title="Expand sidebar"
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-20 flex items-center justify-center w-5 h-8 rounded-none border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-sm"
            >
              <ChevronRight size={12} />
            </button>
          </div>
        ) : (
          <>
            {/* Outer wrapper: positioning context for the toggle button, no overflow */}
            <div className="relative shrink-0" style={{ width: sidebarWidth }}>
              {/* Inner div: scroll container, separate from button positioning */}
              <div className="flex flex-col overflow-y-auto h-full border-r bg-muted w-full">
                {sidebar}
              </div>
              <button
                onClick={onToggleSidebar}
                title="Collapse sidebar"
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-20 flex items-center justify-center w-5 h-8 rounded-none border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-sm"
              >
                <ChevronLeft size={12} />
              </button>
            </div>
            {sidebarDividerProps && <div {...sidebarDividerProps} />}
          </>
        )}

        {/* Center column */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {main}
        </div>

        {/* Right divider + rail — only when rightPanel is provided */}
        {rightPanel != null && (
          <div
            onMouseDown={rightDividerMouseDown}
            style={{ width: '4px', flexShrink: 0, alignSelf: 'stretch' }}
            className="cursor-col-resize select-none bg-border hover:bg-primary/30 transition-colors"
          />
        )}
        {rightPanel != null && (
          <div className="shrink-0 overflow-hidden border-l" style={{ width: rightPanelWidth }}>
            {rightPanel}
          </div>
        )}
      </div>
    </div>
  )
}
