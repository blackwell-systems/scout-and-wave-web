import { useEffect, useRef } from 'react'
import { X, CheckCircle, AlertTriangle, Info, XCircle } from 'lucide-react'

export interface Toast {
  id: string
  type: string
  title: string
  message: string
  severity: 'info' | 'success' | 'warning' | 'error'
  timestamp: number
}

interface ToastProps {
  toasts: Toast[]
  onDismiss: (id: string) => void
  autoDismissMs?: number
}

const MAX_TOASTS = 5

const severityConfig = {
  success: {
    icon: CheckCircle,
    colors: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/50 dark:border-green-700 dark:text-green-300',
    iconColor: 'text-green-600 dark:text-green-400',
  },
  error: {
    icon: XCircle,
    colors: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/50 dark:border-red-700 dark:text-red-300',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  warning: {
    icon: AlertTriangle,
    colors: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/50 dark:border-amber-700 dark:text-amber-300',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
  info: {
    icon: Info,
    colors: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/50 dark:border-blue-700 dark:text-blue-300',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const config = severityConfig[toast.severity]
  const Icon = config.icon

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-lg border shadow-lg transition-all duration-300 ease-out animate-slide-in-right ${config.colors}`}
      role="alert"
      aria-live="polite"
    >
      <Icon className={`w-5 h-5 flex-shrink-0 ${config.iconColor}`} />
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold">{toast.title}</h3>
        <p className="text-sm mt-1 break-words">{toast.message}</p>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

export default function ToastContainer({ toasts, onDismiss, autoDismissMs = 5000 }: ToastProps): JSX.Element {
  const timersRef = useRef<Map<string, number>>(new Map())

  // Auto-dismiss toasts after timeout
  useEffect(() => {
    const timers = timersRef.current

    // Set up timers for new toasts
    toasts.forEach((toast) => {
      if (!timers.has(toast.id)) {
        const timer = setTimeout(() => {
          onDismiss(toast.id)
          timers.delete(toast.id)
        }, autoDismissMs)
        timers.set(toast.id, timer)
      }
    })

    // Clean up timers for dismissed toasts
    const activeIds = new Set(toasts.map((t) => t.id))
    Array.from(timers.keys()).forEach((id) => {
      if (!activeIds.has(id)) {
        clearTimeout(timers.get(id)!)
        timers.delete(id)
      }
    })

    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [toasts, onDismiss, autoDismissMs])

  // Enforce max toasts limit - dismiss oldest when exceeded
  useEffect(() => {
    if (toasts.length > MAX_TOASTS) {
      // Sort by timestamp (oldest first) and dismiss excess
      const sorted = [...toasts].sort((a, b) => a.timestamp - b.timestamp)
      const excessCount = toasts.length - MAX_TOASTS
      for (let i = 0; i < excessCount; i++) {
        onDismiss(sorted[i].id)
      }
    }
  }, [toasts, onDismiss])

  if (toasts.length === 0) {
    return <></>
  }

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-3 max-w-md w-full pointer-events-none">
      <div className="pointer-events-auto space-y-3">
        {toasts.slice(-MAX_TOASTS).map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  )
}
