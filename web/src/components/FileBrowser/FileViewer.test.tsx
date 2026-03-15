// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to define mock functions before vi.mock hoisting
const { mockJavascript, mockPython, mockGo } = vi.hoisted(() => {
  return {
    mockJavascript: vi.fn(() => ({ name: 'javascript-ext' })),
    mockPython: vi.fn(() => ({ name: 'python-ext' })),
    mockGo: vi.fn(() => ({ name: 'go-ext' })),
  }
})

vi.mock('@codemirror/lang-javascript', () => ({
  javascript: mockJavascript,
}))

vi.mock('@codemirror/lang-python', () => ({
  python: mockPython,
}))

vi.mock('@codemirror/lang-go', () => ({
  go: mockGo,
}))

// Mock @uiw/react-codemirror since it uses DOM APIs not available in jsdom
vi.mock('@uiw/react-codemirror', () => ({
  default: vi.fn(({ value, extensions, readOnly, theme, 'data-testid': testId, basicSetup }: {
    value: string
    extensions: unknown[]
    readOnly: boolean
    theme: string
    'data-testid'?: string
    basicSetup?: { lineNumbers?: boolean }
  }) => (
    <div
      data-testid={testId ?? 'codemirror'}
      data-readonly={String(readOnly)}
      data-theme={theme}
      data-has-extensions={String(extensions.length > 0)}
      data-linenumbers={String(basicSetup?.lineNumbers ?? false)}
    >
      <pre>{value}</pre>
    </div>
  )),
}))

import FileViewer from './FileViewer'

describe('FileViewer', () => {
  beforeEach(() => {
    // Default to light mode
    document.documentElement.classList.remove('dark')
    vi.clearAllMocks()
  })

  test('FileViewer renders content', () => {
    const content = 'const x = 1;\nconsole.log(x);'
    render(
      <FileViewer
        content={content}
        language="javascript"
        path="src/index.js"
      />
    )

    // Path is displayed
    expect(screen.getByTestId('file-viewer-path')).toHaveTextContent('src/index.js')

    // Content is rendered inside CodeMirror (multiline — match by pre tag)
    const pre = screen.getByTestId('file-viewer-codemirror').querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre!.textContent).toBe(content)

    // Full viewer container is shown (not skeleton)
    expect(screen.getByTestId('file-viewer')).toBeInTheDocument()
    expect(screen.queryByTestId('file-viewer-skeleton')).not.toBeInTheDocument()
  })

  test('FileViewer shows loading state', () => {
    render(
      <FileViewer
        content=""
        language="javascript"
        path="src/index.js"
        loading={true}
      />
    )

    // Skeleton is shown
    expect(screen.getByTestId('file-viewer-skeleton')).toBeInTheDocument()

    // Editor is NOT shown
    expect(screen.queryByTestId('file-viewer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('file-viewer-codemirror')).not.toBeInTheDocument()
  })

  test('FileViewer applies correct language mode', () => {
    // JavaScript
    const { unmount: unmount1 } = render(
      <FileViewer content="const x = 1" language="javascript" path="file.js" />
    )
    expect(mockJavascript).toHaveBeenCalledWith({ jsx: false })
    unmount1()
    vi.clearAllMocks()

    // TypeScript
    const { unmount: unmount2 } = render(
      <FileViewer content="const x: number = 1" language="typescript" path="file.ts" />
    )
    expect(mockJavascript).toHaveBeenCalledWith({ typescript: true, jsx: false })
    unmount2()
    vi.clearAllMocks()

    // TSX
    const { unmount: unmount3 } = render(
      <FileViewer content="const x: number = 1" language="tsx" path="file.tsx" />
    )
    expect(mockJavascript).toHaveBeenCalledWith({ typescript: true, jsx: true })
    unmount3()
    vi.clearAllMocks()

    // Python
    const { unmount: unmount4 } = render(
      <FileViewer content="def foo(): pass" language="python" path="file.py" />
    )
    expect(mockPython).toHaveBeenCalled()
    unmount4()
    vi.clearAllMocks()

    // Go
    const { unmount: unmount5 } = render(
      <FileViewer content='package main\nfunc main() {}' language="go" path="main.go" />
    )
    expect(mockGo).toHaveBeenCalled()
    unmount5()
    vi.clearAllMocks()

    // YAML — text mode, no language extension
    const { rerender } = render(
      <FileViewer content="key: value" language="yaml" path="config.yaml" />
    )
    expect(mockJavascript).not.toHaveBeenCalled()
    expect(mockPython).not.toHaveBeenCalled()
    expect(mockGo).not.toHaveBeenCalled()
    expect(screen.getByTestId('file-viewer-codemirror')).toHaveAttribute('data-has-extensions', 'false')

    // Markdown — text mode
    vi.clearAllMocks()
    rerender(<FileViewer content="# Hello" language="markdown" path="README.md" />)
    expect(mockJavascript).not.toHaveBeenCalled()
    expect(screen.getByTestId('file-viewer-codemirror')).toHaveAttribute('data-has-extensions', 'false')
  })

  test('FileViewer uses readOnly mode', () => {
    render(
      <FileViewer content="hello" language="javascript" path="file.js" />
    )
    const editor = screen.getByTestId('file-viewer-codemirror')
    expect(editor).toHaveAttribute('data-readonly', 'true')
  })

  test('FileViewer enables line numbers', () => {
    render(
      <FileViewer content="line 1\nline 2" language="go" path="main.go" />
    )
    const editor = screen.getByTestId('file-viewer-codemirror')
    expect(editor).toHaveAttribute('data-linenumbers', 'true')
  })

  test('FileViewer applies dark theme when document has dark class', () => {
    document.documentElement.classList.add('dark')
    render(
      <FileViewer content="const x = 1" language="javascript" path="file.js" />
    )
    expect(screen.getByTestId('file-viewer-codemirror')).toHaveAttribute('data-theme', 'dark')
  })

  test('FileViewer applies light theme in light mode', () => {
    render(
      <FileViewer content="const x = 1" language="javascript" path="file.js" />
    )
    expect(screen.getByTestId('file-viewer-codemirror')).toHaveAttribute('data-theme', 'light')
  })
})
