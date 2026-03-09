interface ActionButtonsProps {
  onApprove: () => void
  onReject: () => void
  onRequestChanges: () => void
  onAskClaude?: () => void
}

const btnBase = "flex items-center justify-center text-sm font-medium px-6 transition-colors border-r"

export default function ActionButtons({ onApprove, onReject, onRequestChanges, onAskClaude }: ActionButtonsProps): JSX.Element {
  return (
    <div className="flex items-stretch h-12">
      <button onClick={onApprove} className={`${btnBase} bg-green-50/60 hover:bg-green-100/80 text-green-700 border-green-200 dark:bg-green-950/40 dark:hover:bg-green-900/60 dark:text-green-400 dark:border-green-800`}>
        Approve
      </button>
      <button onClick={onRequestChanges} className={`${btnBase} bg-amber-50/60 hover:bg-amber-100/80 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:hover:bg-amber-900/60 dark:text-amber-400 dark:border-amber-800`}>
        Request Changes
      </button>
      <button onClick={onReject} className={`${btnBase} bg-red-50/60 hover:bg-red-100/80 text-red-700 border-red-200 dark:bg-red-950/40 dark:hover:bg-red-900/60 dark:text-red-400 dark:border-red-800`}>
        Reject
      </button>
      {onAskClaude && (
        <button onClick={onAskClaude} className={`${btnBase} ml-auto bg-violet-50/60 hover:bg-violet-100/80 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:hover:bg-violet-900/60 dark:text-violet-400 dark:border-violet-800`}>
          Ask Claude
        </button>
      )}
    </div>
  )
}
