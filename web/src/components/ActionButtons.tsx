interface ActionButtonsProps {
  onApprove: () => void
  onReject: () => void
}

export default function ActionButtons({ onApprove, onReject }: ActionButtonsProps): JSX.Element {
  function handleRequestChanges() {
    alert('Edit the IMPL doc in your text editor and reload')
  }

  return (
    <div className="flex items-center gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
      <button
        onClick={onApprove}
        className="px-6 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition-colors"
      >
        Approve
      </button>
      <button
        onClick={handleRequestChanges}
        className="px-6 py-2 rounded-lg text-sm font-medium bg-yellow-400 hover:bg-yellow-500 text-yellow-900 transition-colors"
      >
        Request Changes
      </button>
      <button
        onClick={onReject}
        className="px-6 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
      >
        Reject
      </button>
    </div>
  )
}
