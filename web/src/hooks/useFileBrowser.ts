import { useState, useCallback } from 'react'
import { FileNode, FileTreeResponse, FileContentResponse, GitStatusResponse } from '../types/filebrowser'
import { fetchFileTree, fetchFileContent, fetchFileDiffForBrowser, fetchGitStatus } from '../api'

export function useFileBrowser(repo: string): {
  tree: FileNode | null
  content: string | null
  diff: string | null
  language: string
  loading: boolean
  error: string | null
  selectedPath: string | null
  loadTree: (path?: string) => Promise<void>
  loadFile: (path: string) => Promise<void>
  loadDiff: (path: string) => Promise<void>
  refreshStatus: () => Promise<void>
} {
  const [tree, setTree] = useState<FileNode | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [language, setLanguage] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const loadTree = useCallback(
    async (path?: string): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const response: FileTreeResponse = await fetchFileTree(repo, path)
        setTree(response.root)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [repo],
  )

  const loadFile = useCallback(
    async (path: string): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const response: FileContentResponse = await fetchFileContent(repo, path)
        setContent(response.content)
        setLanguage(response.language)
        setSelectedPath(path)
        setDiff(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [repo],
  )

  const loadDiff = useCallback(
    async (path: string): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetchFileDiffForBrowser(repo, path)
        setDiff(response.diff)
        setSelectedPath(path)
        setContent(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [repo],
  )

  const refreshStatus = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const statusResponse: GitStatusResponse = await fetchGitStatus(repo)
      setTree((currentTree) => {
        if (!currentTree) return currentTree
        return mergeStatusIntoTree(currentTree, statusResponse)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [repo])

  return {
    tree,
    content,
    diff,
    language,
    loading,
    error,
    selectedPath,
    loadTree,
    loadFile,
    loadDiff,
    refreshStatus,
  }
}

/**
 * Recursively merges git status information into the tree nodes by matching paths.
 */
function mergeStatusIntoTree(node: FileNode, statusResponse: GitStatusResponse): FileNode {
  const statusMap = new Map<string, 'M' | 'A' | 'U' | 'D'>()
  for (const entry of statusResponse.files) {
    statusMap.set(entry.path, entry.status)
  }
  return applyStatusToNode(node, statusMap)
}

function applyStatusToNode(
  node: FileNode,
  statusMap: Map<string, 'M' | 'A' | 'U' | 'D'>,
): FileNode {
  const updatedNode: FileNode = {
    ...node,
    gitStatus: statusMap.get(node.path) ?? node.gitStatus ?? null,
  }
  if (node.children && node.children.length > 0) {
    updatedNode.children = node.children.map((child) =>
      applyStatusToNode(child, statusMap),
    )
  }
  return updatedNode
}
