import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table'
import { useWorktrees } from '../hooks/useWorktrees'

function statusBadge(status: 'merged' | 'unmerged' | 'stale') {
  switch (status) {
    case 'merged':
      return <Badge className="bg-green-600 hover:bg-green-600 text-white">merged</Badge>
    case 'unmerged':
      return <Badge className="bg-yellow-500 hover:bg-yellow-500 text-black">unmerged</Badge>
    case 'stale':
      return <Badge variant="destructive">stale</Badge>
  }
}

export default function WorktreePanel({ slug, onClose }: { slug: string; onClose?: () => void }) {
  const { worktrees, loading, error, refresh, deleteBranches, deleteSingle } =
    useWorktrees(slug)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmUnmerged, setConfirmUnmerged] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const allSelected =
    worktrees.length > 0 && worktrees.every((w) => selected.has(w.branch))

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(worktrees.map((w) => w.branch)))
    }
  }

  function toggleOne(branch: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(branch)) {
        next.delete(branch)
      } else {
        next.add(branch)
      }
      return next
    })
  }

  async function handleDeleteSelected(force: boolean) {
    const branches = Array.from(selected)
    if (branches.length === 0) return

    // Check if any selected branches are unmerged and we haven't confirmed yet
    if (!force) {
      const unmergedSelected = worktrees.filter(
        (w) => selected.has(w.branch) && (w.status === 'unmerged' || w.status === 'stale'),
      )
      if (unmergedSelected.length > 0) {
        setConfirmUnmerged(true)
        return
      }
    }

    setDeleting(true)
    try {
      await deleteBranches(branches, force)
      setSelected(new Set())
      setConfirmUnmerged(false)
    } catch {
      // error is surfaced via the hook
    } finally {
      setDeleting(false)
    }
  }

  async function handleDeleteSingle(branch: string) {
    setDeleting(true)
    try {
      await deleteSingle(branch)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(branch)
        return next
      })
    } catch {
      // error is surfaced via the hook
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">Worktrees</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            Refresh
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={selected.size === 0 || deleting}
            onClick={() => handleDeleteSelected(false)}
          >
            Delete Selected ({selected.size})
          </Button>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {confirmUnmerged && (
          <div className="mb-4 flex items-center gap-3 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm">
            <span>
              {worktrees.filter(
                (w) => selected.has(w.branch) && (w.status === 'unmerged' || w.status === 'stale'),
              ).length}{' '}
              branch(es) are unmerged. Delete anyway?
            </span>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => handleDeleteSelected(true)}
            >
              Force Delete
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmUnmerged(false)}
            >
              Cancel
            </Button>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Loading worktrees...</p>
        ) : worktrees.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No SAW branches found</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="cursor-pointer"
                  />
                </TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Has Unsaved</TableHead>
                <TableHead>Last Commit</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {worktrees.map((w) => (
                <TableRow key={w.branch}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.has(w.branch)}
                      onChange={() => toggleOne(w.branch)}
                      className="cursor-pointer"
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{w.branch}</TableCell>
                  <TableCell>{statusBadge(w.status)}</TableCell>
                  <TableCell>
                    {w.has_unsaved && (
                      <span title="Unsaved changes" className="text-yellow-500">
                        &#9888;
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {w.last_commit_age ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={deleting}
                      onClick={() => handleDeleteSingle(w.branch)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
