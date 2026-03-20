export interface StatusBadgeProps {
  status: string
  size?: 'sm' | 'md'
  className?: string
}

const sizeClasses = {
  sm: 'text-[10px] px-1.5 py-0.5',
  md: 'text-xs px-2 py-0.5',
}

// ---- Agent Status Badge ----
// Matches color patterns from AgentCard.tsx and WaveBoard.tsx

const agentStatusConfig: Record<string, { label: string; classes: string }> = {
  pending: {
    label: 'Pending',
    classes: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700',
  },
  running: {
    label: 'Running',
    classes: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800 animate-pulse',
  },
  complete: {
    label: 'Complete',
    classes: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
  },
  failed: {
    label: 'Failed',
    classes: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
  },
}

export function AgentStatusBadge({ status, size = 'md', className = '' }: StatusBadgeProps): JSX.Element {
  const config = agentStatusConfig[status] ?? agentStatusConfig.pending
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${sizeClasses[size]} ${config.classes} ${className}`}
      data-testid={`agent-status-badge-${status}`}
    >
      {config.label}
    </span>
  )
}

// ---- Wave Status Badge ----
// Extracted from WaveBoard.tsx wave header patterns

const waveStatusConfig: Record<string, { label: string; classes: string }> = {
  pending: {
    label: 'Pending',
    classes: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700',
  },
  running: {
    label: 'Running',
    classes: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800 animate-pulse',
  },
  complete: {
    label: 'Complete',
    classes: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
  },
  partial: {
    label: 'Partial',
    classes: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
  },
  merged: {
    label: 'Merged',
    classes: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
  },
  failed: {
    label: 'Failed',
    classes: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
  },
}

export function WaveStatusBadge({ status, size = 'md', className = '' }: StatusBadgeProps): JSX.Element {
  const config = waveStatusConfig[status] ?? waveStatusConfig.pending
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${sizeClasses[size]} ${config.classes} ${className}`}
      data-testid={`wave-status-badge-${status}`}
    >
      {config.label}
    </span>
  )
}

// ---- IMPL Status Badge ----
// Extracted from ProgramBoard.tsx getImplStatusBadge and ImplList.tsx patterns

const implStatusConfig: Record<string, { label: string; classes: string }> = {
  complete: {
    label: 'Complete',
    classes: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
  },
  executing: {
    label: 'Executing',
    classes: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800 animate-pulse',
  },
  'in-progress': {
    label: 'In Progress',
    classes: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800 animate-pulse',
  },
  reviewed: {
    label: 'Reviewed',
    classes: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
  },
  scouting: {
    label: 'Scouting',
    classes: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800 animate-pulse',
  },
  blocked: {
    label: 'Blocked',
    classes: 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
  },
  'not-suitable': {
    label: 'Not Suitable',
    classes: 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800',
  },
  pending: {
    label: 'Pending',
    classes: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700',
  },
}

export function ImplStatusBadge({ status, size = 'md', className = '' }: StatusBadgeProps): JSX.Element {
  const config = implStatusConfig[status] ?? implStatusConfig.pending
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${sizeClasses[size]} ${config.classes} ${className}`}
      data-testid={`impl-status-badge-${status}`}
    >
      {config.label}
    </span>
  )
}
