interface ActionButtonsProps {
  onApprove: () => void
  onReject: () => void
}

const btnBase = "inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 py-2 transition-colors border"

export default function ActionButtons({ onApprove, onReject }: ActionButtonsProps): JSX.Element {
  function handleRequestChanges() {
    alert('Edit the IMPL doc in your text editor and reload')
  }

  return (
    <div className="flex items-center gap-3 pt-4 border-t">
      <button onClick={onApprove} className={`${btnBase} bg-green-50/60 hover:bg-green-100/80 text-green-700 border-green-200 dark:bg-green-950/40 dark:hover:bg-green-900/60 dark:text-green-400 dark:border-green-800`}>
        Approve
      </button>
      <button onClick={handleRequestChanges} className={`${btnBase} bg-amber-50/60 hover:bg-amber-100/80 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:hover:bg-amber-900/60 dark:text-amber-400 dark:border-amber-800`}>
        Request Changes
      </button>
      <button onClick={onReject} className={`${btnBase} bg-red-50/60 hover:bg-red-100/80 text-red-700 border-red-200 dark:bg-red-950/40 dark:hover:bg-red-900/60 dark:text-red-400 dark:border-red-800`}>
        Reject
      </button>
    </div>
  )
}
