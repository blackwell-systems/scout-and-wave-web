// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useFileBrowser } from './useFileBrowser'
import { FileNode, FileTreeResponse, FileContentResponse, GitStatusResponse } from '../types/filebrowser'

// Mock the API module
vi.mock('../api', () => ({
  fetchFileTree: vi.fn(),
  fetchFileContent: vi.fn(),
  fetchFileDiffForBrowser: vi.fn(),
  fetchGitStatus: vi.fn(),
}))

import * as api from '../api'

const mockRoot: FileNode = {
  name: 'my-repo',
  path: '',
  isDir: true,
  children: [
    { name: 'src', path: 'src', isDir: true, children: [] },
    { name: 'README.md', path: 'README.md', isDir: false },
  ],
}

const mockTreeResponse: FileTreeResponse = {
  repo: 'my-repo',
  root: mockRoot,
}

const mockContentResponse: FileContentResponse = {
  repo: 'my-repo',
  path: 'README.md',
  content: '# Hello World',
  language: 'markdown',
  size: 13,
}

const mockDiffResponse = {
  repo: 'my-repo',
  path: 'README.md',
  diff: '@@ -1 +1 @@\n-old line\n+new line',
}

const mockStatusResponse: GitStatusResponse = {
  repo: 'my-repo',
  files: [
    { path: 'README.md', status: 'M' },
    { path: 'src/index.ts', status: 'A' },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useFileBrowser', () => {
  it('loads tree on mount — initial state is null (no auto-load)', () => {
    const { result } = renderHook(() => useFileBrowser('my-repo'))

    // Hook should NOT auto-load tree on mount
    expect(result.current.tree).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(api.fetchFileTree).not.toHaveBeenCalled()
  })

  it('useFileBrowser loads tree on mount — loadTree populates tree', async () => {
    vi.mocked(api.fetchFileTree).mockResolvedValueOnce(mockTreeResponse)

    const { result } = renderHook(() => useFileBrowser('my-repo'))

    expect(result.current.tree).toBeNull()

    await act(async () => {
      await result.current.loadTree()
    })

    expect(api.fetchFileTree).toHaveBeenCalledWith('my-repo', undefined)
    expect(result.current.tree).toEqual(mockRoot)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('loadTree passes path argument to API', async () => {
    vi.mocked(api.fetchFileTree).mockResolvedValueOnce(mockTreeResponse)

    const { result } = renderHook(() => useFileBrowser('my-repo'))

    await act(async () => {
      await result.current.loadTree('src')
    })

    expect(api.fetchFileTree).toHaveBeenCalledWith('my-repo', 'src')
  })

  it('useFileBrowser loads file content', async () => {
    vi.mocked(api.fetchFileContent).mockResolvedValueOnce(mockContentResponse)

    const { result } = renderHook(() => useFileBrowser('my-repo'))

    expect(result.current.content).toBeNull()
    expect(result.current.language).toBe('')

    await act(async () => {
      await result.current.loadFile('README.md')
    })

    expect(api.fetchFileContent).toHaveBeenCalledWith('my-repo', 'README.md')
    expect(result.current.content).toBe('# Hello World')
    expect(result.current.language).toBe('markdown')
    expect(result.current.selectedPath).toBe('README.md')
    expect(result.current.diff).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('loadFile clears diff when loading a file', async () => {
    vi.mocked(api.fetchFileDiffForBrowser).mockResolvedValueOnce(mockDiffResponse)
    vi.mocked(api.fetchFileContent).mockResolvedValueOnce(mockContentResponse)

    const { result } = renderHook(() => useFileBrowser('my-repo'))

    // First load a diff
    await act(async () => {
      await result.current.loadDiff('README.md')
    })
    expect(result.current.diff).toBe('@@ -1 +1 @@\n-old line\n+new line')

    // Then load a file — diff should be cleared
    await act(async () => {
      await result.current.loadFile('README.md')
    })
    expect(result.current.diff).toBeNull()
    expect(result.current.content).toBe('# Hello World')
  })

  it('loadDiff loads diff and clears content', async () => {
    vi.mocked(api.fetchFileDiffForBrowser).mockResolvedValueOnce(mockDiffResponse)

    const { result } = renderHook(() => useFileBrowser('my-repo'))

    await act(async () => {
      await result.current.loadDiff('README.md')
    })

    expect(api.fetchFileDiffForBrowser).toHaveBeenCalledWith('my-repo', 'README.md')
    expect(result.current.diff).toBe('@@ -1 +1 @@\n-old line\n+new line')
    expect(result.current.content).toBeNull()
    expect(result.current.selectedPath).toBe('README.md')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('useFileBrowser handles API errors — loadTree error', async () => {
    vi.mocked(api.fetchFileTree).mockRejectedValueOnce(new Error('HTTP 404: not found'))

    const { result } = renderHook(() => useFileBrowser('my-repo'))

    await act(async () => {
      await result.current.loadTree()
    })

    expect(result.current.tree).toBeNull()
    expect(result.current.error).toBe('HTTP 404: not found')
    expect(result.current.loading).toBe(false)
  })

  it('useFileBrowser handles API errors — loadFile error', async () => {
    vi.mocked(api.fetchFileContent).mockRejectedValueOnce(new Error('HTTP 413: file too large'))

    const { result } = renderHook(() => useFileBrowser('my-repo'))

    await act(async () => {
      await result.current.loadFile('large-file.bin')
    })

    expect(result.current.content).toBeNull()
    expect(result.current.error).toBe('HTTP 413: file too large')
    expect(result.current.loading).toBe(false)
  })

  it('useFileBrowser handles API errors — loadDiff error', async () => {
    vi.mocked(api.fetchFileDiffForBrowser).mockRejectedValueOnce(
      new Error('HTTP 400: file not modified'),
    )

    const { result } = renderHook(() => useFileBrowser('my-repo'))

    await act(async () => {
      await result.current.loadDiff('unchanged.ts')
    })

    expect(result.current.diff).toBeNull()
    expect(result.current.error).toBe('HTTP 400: file not modified')
    expect(result.current.loading).toBe(false)
  })

  it('error is cleared on subsequent successful operation', async () => {
    vi.mocked(api.fetchFileTree)
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(mockTreeResponse)

    const { result } = renderHook(() => useFileBrowser('my-repo'))

    // First call fails
    await act(async () => {
      await result.current.loadTree()
    })
    expect(result.current.error).toBe('network error')

    // Second call succeeds — error should be cleared
    await act(async () => {
      await result.current.loadTree()
    })
    expect(result.current.error).toBeNull()
    expect(result.current.tree).toEqual(mockRoot)
  })

  it('useFileBrowser refreshes git status', async () => {
    // First load the tree
    vi.mocked(api.fetchFileTree).mockResolvedValueOnce(mockTreeResponse)
    vi.mocked(api.fetchGitStatus).mockResolvedValueOnce(mockStatusResponse)

    const { result } = renderHook(() => useFileBrowser('my-repo'))

    await act(async () => {
      await result.current.loadTree()
    })

    expect(result.current.tree).toEqual(mockRoot)

    // Now refresh status
    await act(async () => {
      await result.current.refreshStatus()
    })

    expect(api.fetchGitStatus).toHaveBeenCalledWith('my-repo')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()

    // Tree should have gitStatus merged in
    const updatedTree = result.current.tree!
    expect(updatedTree).not.toBeNull()

    // README.md at root level should be marked as 'M'
    const readmeNode = updatedTree.children?.find((c) => c.path === 'README.md')
    expect(readmeNode?.gitStatus).toBe('M')
  })

  it('refreshStatus does not crash when tree is null', async () => {
    vi.mocked(api.fetchGitStatus).mockResolvedValueOnce(mockStatusResponse)

    const { result } = renderHook(() => useFileBrowser('my-repo'))

    expect(result.current.tree).toBeNull()

    await act(async () => {
      await result.current.refreshStatus()
    })

    // Tree remains null, no error
    expect(result.current.tree).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('refreshStatus handles API error', async () => {
    vi.mocked(api.fetchGitStatus).mockRejectedValueOnce(new Error('HTTP 400: repo not found'))

    const { result } = renderHook(() => useFileBrowser('my-repo'))

    await act(async () => {
      await result.current.refreshStatus()
    })

    expect(result.current.error).toBe('HTTP 400: repo not found')
    expect(result.current.loading).toBe(false)
  })

  it('loading is true during async operations', async () => {
    let resolveTree!: (value: FileTreeResponse) => void
    const treePromise = new Promise<FileTreeResponse>((res) => {
      resolveTree = res
    })
    vi.mocked(api.fetchFileTree).mockReturnValueOnce(treePromise)

    const { result } = renderHook(() => useFileBrowser('my-repo'))

    expect(result.current.loading).toBe(false)

    let loadPromise: Promise<void>
    act(() => {
      loadPromise = result.current.loadTree()
    })

    expect(result.current.loading).toBe(true)

    await act(async () => {
      resolveTree(mockTreeResponse)
      await loadPromise
    })

    expect(result.current.loading).toBe(false)
  })
})
