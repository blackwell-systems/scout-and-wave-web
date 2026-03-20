import React from 'react'

// ---- Loading Spinner ----

export function LoadingSpinner({ className = '' }: { className?: string }): JSX.Element {
  return (
    <div
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent h-4 w-4 ${className}`}
      role="status"
      aria-label="Loading"
      data-testid="loading-spinner"
    >
      <span className="sr-only">Loading...</span>
    </div>
  )
}

// ---- Loading Skeleton ----
// Extracted from App.tsx lines 503-511 pulse animation pattern

export function LoadingSkeleton({ lines = 3, className = '' }: { lines?: number; className?: string }): JSX.Element {
  const widths = ['w-1/3', 'w-2/3', 'w-1/2', 'w-3/4', 'w-1/4']
  return (
    <div className={`p-6 space-y-4 ${className}`} data-testid="loading-skeleton">
      {[...Array(lines)].map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="animate-pulse h-5 bg-muted rounded w-1/3" />
          <div className={`animate-pulse h-3 bg-muted rounded ${widths[(i * 2 + 1) % widths.length]}`} />
          <div className={`animate-pulse h-3 bg-muted rounded ${widths[(i * 2 + 2) % widths.length]}`} />
        </div>
      ))}
    </div>
  )
}

// ---- Error Display ----
// Extracted from App.tsx line 501 error pattern

export function ErrorDisplay({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 p-4" data-testid="error-display">
      <p className="text-destructive text-sm">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs px-3 py-1.5 rounded border border-border bg-background text-foreground hover:bg-muted transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  )
}

// ---- Empty State ----
// Extracted from App.tsx lines 521-531 "No plan selected" and line 484 "No programs yet"

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8" data-testid="empty-state">
      {icon && <div className="text-muted-foreground/30">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
