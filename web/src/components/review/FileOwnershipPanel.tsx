import { useState } from 'react'
import { Eye } from 'lucide-react'
import { IMPLDocResponse, RepoEntry, FileOwnershipEntry } from '../../types'
import { Card, CardContent } from '../ui/card'
import FileOwnershipTable from '../FileOwnershipTable'
import FileModal from '../FileBrowser/FileModal'

function detectRepoName(filePath: string, repos: RepoEntry[]): string {
  let best = ''
  let bestLen = 0
  for (const r of repos) {
    if (filePath.startsWith(r.path) && r.path.length > bestLen) {
      best = r.name
      bestLen = r.path.length
    }
  }
  return best
}

interface FileOwnershipPanelProps {
  impl: IMPLDocResponse
  repos?: RepoEntry[]    // optional — graceful fallback when not provided  {/* TODO: thread repos from App via ReviewScreen */}
  onFileClick?: (file: string, agent: string, wave: number) => void
}

interface ModalState {
  open: boolean
  filePath: string
  repo: string
}

export default function FileOwnershipPanel({ impl, repos = [], onFileClick }: FileOwnershipPanelProps): JSX.Element {
  const entries = impl.file_ownership

  const [modalState, setModalState] = useState<ModalState>({
    open: false,
    filePath: '',
    repo: '',
  })

  function handleViewFile(entry: FileOwnershipEntry) {
    // Determine which repo to use for the modal
    let repoName = ''
    if (entry.repo) {
      repoName = entry.repo
    } else if (repos.length > 0) {
      repoName = repos[0].name
    }
    setModalState({ open: true, filePath: entry.file, repo: repoName })
  }

  function handleCloseModal() {
    setModalState(prev => ({ ...prev, open: false }))
  }

  // Render a view button for a file entry (only for non-deleted files)
  function renderViewButton(entry: FileOwnershipEntry) {
    if (entry.action === 'delete') return null
    return (
      <button
        type="button"
        aria-label={`View file ${entry.file}`}
        data-testid="view-file-btn"
        onClick={() => handleViewFile(entry)}
        className="inline-flex items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors bg-transparent border-0 cursor-pointer ml-1"
      >
        <Eye size={14} aria-hidden="true" />
      </button>
    )
  }

  // Determine if we should group by repo
  const shouldGroup = (() => {
    if (!repos || repos.length === 0) return false
    const repoNames = new Set(entries.map(e => detectRepoName(e.file, repos)))
    // Filter out empty string (no match) to count distinct matched repos
    const matchedRepos = new Set([...repoNames].filter(n => n !== ''))
    return matchedRepos.size >= 2
  })()

  const modal = modalState.open && modalState.repo ? (
    <FileModal
      repo={modalState.repo}
      initialFile={modalState.filePath}
      onClose={handleCloseModal}
    />
  ) : null

  if (!shouldGroup) {
    return (
      <>
        <Card>
          <CardContent className="pt-6">
            <FileOwnershipTable
              fileOwnership={entries}
              col4Name={impl.file_ownership_col4_name}
              onFileClick={onFileClick}
              renderViewButton={renderViewButton}
            />
          </CardContent>
        </Card>
        {modal}
      </>
    )
  }

  // Group entries by detected repo name
  const groups = new Map<string, FileOwnershipEntry[]>()
  for (const entry of entries) {
    const repoName = detectRepoName(entry.file, repos) || 'other'
    if (!groups.has(repoName)) {
      groups.set(repoName, [])
    }
    groups.get(repoName)!.push(entry)
  }

  // Sort groups: named repos first (in order they appear in repos array), then "other"
  const repoOrder = repos.map(r => r.name)
  const sortedGroups = [...groups.entries()].sort(([a], [b]) => {
    const ai = repoOrder.indexOf(a)
    const bi = repoOrder.indexOf(b)
    if (a === 'other') return 1
    if (b === 'other') return -1
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          {sortedGroups.map(([repoName, group]) => (
            <details key={repoName} open className="mb-2">
              <summary className="text-sm font-medium px-2 py-1.5 cursor-pointer select-none list-none flex items-center gap-1">
                <span className="text-muted-foreground text-xs">▶</span>
                <span>{repoName}</span>
                <span className="text-xs text-muted-foreground ml-1">({group.length} files)</span>
              </summary>
              <FileOwnershipTable
                fileOwnership={group}
                col4Name={impl.file_ownership_col4_name}
                onFileClick={onFileClick}
                renderViewButton={renderViewButton}
              />
            </details>
          ))}
        </CardContent>
      </Card>
      {modal}
    </>
  )
}
