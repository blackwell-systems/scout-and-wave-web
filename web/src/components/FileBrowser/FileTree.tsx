import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react'
import { FileNode } from '../../types/filebrowser'

// ─── Props interfaces ────────────────────────────────────────────────────────

export interface FileTreeProps {
  tree: FileNode
  onSelect: (path: string, isDir: boolean) => void
  selectedPath?: string | null
}

interface TreeNodeProps {
  node: FileNode
  depth: number
  onSelect: (path: string, isDir: boolean) => void
  selectedPath?: string | null
}

// ─── Git status badge ────────────────────────────────────────────────────────

interface GitBadgeProps {
  status: 'M' | 'A' | 'U' | 'D'
}

function GitBadge({ status }: GitBadgeProps) {
  const config: Record<'M' | 'A' | 'U' | 'D', { dotColor: string; label: string }> = {
    M: { dotColor: 'bg-yellow-400', label: 'M' },
    A: { dotColor: 'bg-green-400', label: 'A' },
    U: { dotColor: 'bg-blue-400', label: 'U' },
    D: { dotColor: 'bg-red-400', label: 'D' },
  }

  const { dotColor, label } = config[status]

  return (
    <span className="ml-auto flex items-center gap-0.5 shrink-0" data-testid={`git-badge-${status}`}>
      <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} aria-hidden="true" />
      <span className="text-xs font-mono leading-none">{label}</span>
    </span>
  )
}

// ─── Individual tree node ────────────────────────────────────────────────────

function TreeNode({ node, depth, onSelect, selectedPath }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false)

  // Auto-expand first 2 levels (depth 0 and depth 1)
  useEffect(() => {
    if (node.isDir && depth < 2) {
      setExpanded(true)
    }
  }, [node.isDir, depth])

  const isSelected = selectedPath === node.path
  const isDeleted = node.gitStatus === 'D'

  function handleClick() {
    if (node.isDir) {
      setExpanded((prev) => !prev)
    }
    onSelect(node.path, node.isDir)
  }

  const indentStyle = { paddingLeft: depth * 16 }

  return (
    <div>
      <button
        type="button"
        className={[
          'w-full flex items-center gap-1 px-2 py-0.5 text-sm text-left rounded',
          'hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer',
          isSelected
            ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
            : 'text-gray-800 dark:text-gray-200',
        ].join(' ')}
        style={indentStyle}
        onClick={handleClick}
        data-testid={`tree-node-${node.path}`}
        aria-expanded={node.isDir ? expanded : undefined}
      >
        {/* Chevron for directories */}
        {node.isDir ? (
          <span className="shrink-0 text-gray-400 dark:text-gray-500 w-4 h-4">
            {expanded ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} aria-hidden="true" />
            )}
          </span>
        ) : (
          // Spacer so files align with dir names
          <span className="shrink-0 w-4 h-4" aria-hidden="true" />
        )}

        {/* Folder / File icon */}
        <span className="shrink-0 text-gray-500 dark:text-gray-400">
          {node.isDir ? (
            expanded ? (
              <FolderOpen size={14} aria-hidden="true" />
            ) : (
              <Folder size={14} aria-hidden="true" />
            )
          ) : (
            <File size={14} aria-hidden="true" />
          )}
        </span>

        {/* Node name – strikethrough for deleted items */}
        <span
          className={['truncate flex-1', isDeleted ? 'line-through opacity-60' : ''].join(' ')}
        >
          {node.name}
        </span>

        {/* Git status badge */}
        {node.gitStatus != null && <GitBadge status={node.gitStatus} />}
      </button>

      {/* Recursive children */}
      {node.isDir && expanded && node.children && node.children.length > 0 && (
        <div role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Public component ────────────────────────────────────────────────────────

export default function FileTree({ tree, onSelect, selectedPath }: FileTreeProps) {
  return (
    <div className="overflow-y-auto h-full" data-testid="file-tree">
      <TreeNode
        node={tree}
        depth={0}
        onSelect={onSelect}
        selectedPath={selectedPath}
      />
    </div>
  )
}
