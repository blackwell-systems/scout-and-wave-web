import { useState, useEffect, useCallback } from 'react'
import { WorktreeEntry } from '../types'
import { listWorktrees, deleteWorktree, batchDeleteWorktrees } from '../api'

export function useWorktrees(slug: string) {
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    listWorktrees(slug)
      .then((res) => {
        setWorktrees(res.worktrees ?? [])
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        setLoading(false)
      })
  }, [slug])

  useEffect(() => {
    refresh()
  }, [refresh])

  const deleteBranches = useCallback(
    async (branches: string[], force: boolean) => {
      await batchDeleteWorktrees(slug, { branches, force })
      refresh()
    },
    [slug, refresh],
  )

  const deleteSingle = useCallback(
    async (branch: string) => {
      await deleteWorktree(slug, branch)
      refresh()
    },
    [slug, refresh],
  )

  return { worktrees, loading, error, refresh, deleteBranches, deleteSingle }
}
