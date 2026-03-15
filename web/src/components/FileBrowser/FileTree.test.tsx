// @vitest-environment jsdom
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import FileTree from './FileTree'
import { FileNode } from '../../types/filebrowser'

// ─── Sample tree fixture ─────────────────────────────────────────────────────

const sampleTree: FileNode = {
  name: 'root',
  path: '/',
  isDir: true,
  children: [
    {
      name: 'src',
      path: '/src',
      isDir: true,
      children: [
        {
          name: 'components',
          path: '/src/components',
          isDir: true,
          children: [
            {
              name: 'App.tsx',
              path: '/src/components/App.tsx',
              isDir: false,
              gitStatus: null,
            },
          ],
        },
        {
          name: 'index.ts',
          path: '/src/index.ts',
          isDir: false,
          gitStatus: null,
        },
      ],
    },
    {
      name: 'README.md',
      path: '/README.md',
      isDir: false,
      gitStatus: null,
    },
  ],
}

const treeWithGitStatus: FileNode = {
  name: 'root',
  path: '/',
  isDir: true,
  children: [
    { name: 'modified.ts', path: '/modified.ts', isDir: false, gitStatus: 'M' },
    { name: 'added.ts', path: '/added.ts', isDir: false, gitStatus: 'A' },
    { name: 'untracked.ts', path: '/untracked.ts', isDir: false, gitStatus: 'U' },
    { name: 'deleted.ts', path: '/deleted.ts', isDir: false, gitStatus: 'D' },
    { name: 'normal.ts', path: '/normal.ts', isDir: false, gitStatus: null },
  ],
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FileTree', () => {
  test('FileTree renders tree structure', () => {
    render(<FileTree tree={sampleTree} onSelect={vi.fn()} />)

    // The root node should be rendered
    expect(screen.getByTestId('file-tree')).toBeInTheDocument()

    // Root dir rendered
    expect(screen.getByText('root')).toBeInTheDocument()

    // Level 1 – auto-expanded so "src" and "README.md" should be visible
    expect(screen.getByText('src')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()

    // Level 2 – "components" and "index.ts" should also be visible (depth 1 auto-expands)
    expect(screen.getByText('components')).toBeInTheDocument()
    expect(screen.getByText('index.ts')).toBeInTheDocument()
  })

  test('FileTree expands/collapses directories', async () => {
    render(<FileTree tree={sampleTree} onSelect={vi.fn()} />)

    // After initial render, "components" (depth 1, auto-expanded) is visible.
    // "App.tsx" is at depth 2 – "components" dir is NOT auto-expanded, so App.tsx should be hidden.
    expect(screen.queryByText('App.tsx')).not.toBeInTheDocument()

    // Click "components" to expand it
    const componentsNode = screen.getByTestId('tree-node-/src/components')
    fireEvent.click(componentsNode)

    expect(screen.getByText('App.tsx')).toBeInTheDocument()

    // Click "components" again to collapse
    fireEvent.click(componentsNode)
    expect(screen.queryByText('App.tsx')).not.toBeInTheDocument()
  })

  test('FileTree highlights selected file', () => {
    render(
      <FileTree tree={sampleTree} onSelect={vi.fn()} selectedPath="/src/index.ts" />
    )

    const selectedNode = screen.getByTestId('tree-node-/src/index.ts')
    // Selected node should have blue background classes
    expect(selectedNode.className).toMatch(/bg-blue/)

    // Non-selected nodes should NOT have blue background
    const readmeNode = screen.getByTestId('tree-node-/README.md')
    expect(readmeNode.className).not.toMatch(/bg-blue/)
  })

  test('FileTree auto-expands first 2 levels', () => {
    render(<FileTree tree={sampleTree} onSelect={vi.fn()} />)

    // depth 0 = root → auto-expanded → shows "src" and "README.md"
    expect(screen.getByText('src')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()

    // depth 1 = "src" → auto-expanded → shows "components" and "index.ts"
    expect(screen.getByText('components')).toBeInTheDocument()
    expect(screen.getByText('index.ts')).toBeInTheDocument()

    // depth 2 = "components" → NOT auto-expanded → "App.tsx" should NOT be visible
    expect(screen.queryByText('App.tsx')).not.toBeInTheDocument()
  })

  test('FileTree shows git status badges', () => {
    render(<FileTree tree={treeWithGitStatus} onSelect={vi.fn()} />)

    // Each git badge should be visible with the correct label
    expect(screen.getByTestId('git-badge-M')).toBeInTheDocument()
    expect(screen.getByTestId('git-badge-A')).toBeInTheDocument()
    expect(screen.getByTestId('git-badge-U')).toBeInTheDocument()
    expect(screen.getByTestId('git-badge-D')).toBeInTheDocument()

    // Badge text labels
    const badgeM = screen.getByTestId('git-badge-M')
    expect(within(badgeM).getByText('M')).toBeInTheDocument()

    const badgeA = screen.getByTestId('git-badge-A')
    expect(within(badgeA).getByText('A')).toBeInTheDocument()

    const badgeU = screen.getByTestId('git-badge-U')
    expect(within(badgeU).getByText('U')).toBeInTheDocument()

    const badgeD = screen.getByTestId('git-badge-D')
    expect(within(badgeD).getByText('D')).toBeInTheDocument()

    // Deleted file should have strikethrough
    const deletedNode = screen.getByTestId('tree-node-/deleted.ts')
    const deletedName = within(deletedNode).getByText('deleted.ts')
    expect(deletedName.className).toMatch(/line-through/)

    // Normal file with no git status should have NO badge
    expect(screen.queryByTestId('git-badge-null')).not.toBeInTheDocument()
  })

  test('FileTree calls onSelect when a file is clicked', () => {
    const onSelect = vi.fn()
    render(<FileTree tree={sampleTree} onSelect={onSelect} />)

    const readmeNode = screen.getByTestId('tree-node-/README.md')
    fireEvent.click(readmeNode)

    expect(onSelect).toHaveBeenCalledWith('/README.md', false)
  })

  test('FileTree calls onSelect and toggles expand when a directory is clicked', () => {
    const onSelect = vi.fn()
    render(<FileTree tree={sampleTree} onSelect={onSelect} />)

    // "src" is at depth 1 and is auto-expanded; click to collapse
    const srcNode = screen.getByTestId('tree-node-/src')
    fireEvent.click(srcNode)

    expect(onSelect).toHaveBeenCalledWith('/src', true)
  })
})
