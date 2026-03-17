import { useState, useEffect } from 'react'
import { QueueItem, AddQueueItemRequest } from '../types/autonomy'
import { fetchQueue, addQueueItem, deleteQueueItem } from '../autonomyApi'
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { Button } from './ui/button'

interface QueuePanelProps {
  onSelectItem?: (slug: string) => void
}

export default function QueuePanel({ onSelectItem }: QueuePanelProps): JSX.Element {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  // Add form state
  const [newTitle, setNewTitle] = useState('')
  const [newPriority, setNewPriority] = useState(10)
  const [newDescription, setNewDescription] = useState('')
  const [newDependsOn, setNewDependsOn] = useState('')
  const [newRequireReview, setNewRequireReview] = useState(false)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    loadQueue()
  }, [])

  async function loadQueue() {
    try {
      setError(null)
      const queue = await fetchQueue()
      setItems(queue)
      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  async function handleAdd() {
    if (!newTitle.trim() || !newDescription.trim()) {
      return
    }

    setAdding(true)
    setError(null)
    try {
      const req: AddQueueItemRequest = {
        title: newTitle,
        priority: newPriority,
        feature_description: newDescription,
        depends_on: newDependsOn.trim() ? newDependsOn.split(',').map(s => s.trim()) : undefined,
        require_review: newRequireReview,
      }
      await addQueueItem(req)
      // Reset form
      setNewTitle('')
      setNewPriority(10)
      setNewDescription('')
      setNewDependsOn('')
      setNewRequireReview(false)
      setShowAddForm(false)
      loadQueue()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(slug: string) {
    if (!window.confirm(`Delete queue item "${slug}"?`)) {
      return
    }

    try {
      setError(null)
      await deleteQueueItem(slug)
      loadQueue()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        Loading queue...
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Queue</h3>
        <Button
          onClick={() => setShowAddForm(!showAddForm)}
          size="sm"
          variant="outline"
        >
          <Plus size={14} />
          Add Item
        </Button>
      </div>

      {error && (
        <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
          {error}
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div className="rounded-lg border border-border bg-card p-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="queue-title" className="text-xs text-muted-foreground">
              Title
            </label>
            <input
              id="queue-title"
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              className="text-sm px-2 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Feature title"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="queue-priority" className="text-xs text-muted-foreground">
              Priority
            </label>
            <input
              id="queue-priority"
              type="number"
              value={newPriority}
              onChange={e => setNewPriority(parseInt(e.target.value, 10))}
              className="text-sm px-2 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="queue-description" className="text-xs text-muted-foreground">
              Description
            </label>
            <textarea
              id="queue-description"
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
              rows={3}
              className="text-sm px-2 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              placeholder="Feature description"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="queue-depends" className="text-xs text-muted-foreground">
              Depends On (comma-separated slugs)
            </label>
            <input
              id="queue-depends"
              type="text"
              value={newDependsOn}
              onChange={e => setNewDependsOn(e.target.value)}
              className="text-sm px-2 py-1.5 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="e.g., feature-a, feature-b"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={newRequireReview}
              onChange={e => setNewRequireReview(e.target.checked)}
              className="rounded border-border accent-primary"
            />
            <span className="text-sm">Require review</span>
          </label>

          <div className="flex items-center gap-2 justify-end">
            <Button onClick={() => setShowAddForm(false)} variant="outline" size="sm" disabled={adding}>
              Cancel
            </Button>
            <Button onClick={handleAdd} size="sm" disabled={adding}>
              {adding ? 'Adding...' : 'Add'}
            </Button>
          </div>
        </div>
      )}

      {/* Queue items list */}
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">
          Queue is empty. Add an item to get started.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item, idx) => (
            <div
              key={item.slug ?? idx}
              className="rounded-md border border-border bg-card p-3 flex flex-col gap-2 hover:bg-accent/50 transition-colors cursor-pointer"
              onClick={() => item.slug && onSelectItem?.(item.slug)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{item.title}</div>
                  <div className="text-xs text-muted-foreground">
                    Priority: {item.priority} • Status: {item.status}
                  </div>
                  {item.depends_on && item.depends_on.length > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Depends on: {item.depends_on.join(', ')}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      if (item.slug) handleDelete(item.slug)
                    }}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Delete item"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
