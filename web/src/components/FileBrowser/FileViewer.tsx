import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { go } from '@codemirror/lang-go'

export interface FileViewerProps {
  content: string
  language: string
  path: string
  loading?: boolean
}

function getLanguageExtension(language: string) {
  switch (language) {
    case 'go':
      return go()
    case 'typescript':
    case 'tsx':
      return javascript({ typescript: true, jsx: language === 'tsx' })
    case 'javascript':
    case 'jsx':
      return javascript({ jsx: language === 'jsx' })
    case 'python':
      return python()
    // text / no highlighting
    case 'yaml':
    case 'yml':
    case 'markdown':
    case 'md':
    default:
      return null
  }
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark')
}

export default function FileViewer({ content, language, path, loading = false }: FileViewerProps): JSX.Element {
  const extensions = useMemo(() => {
    const ext = getLanguageExtension(language)
    return ext ? [ext] : []
  }, [language])

  const dark = isDarkMode()

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4" data-testid="file-viewer-skeleton">
        <div className="h-4 w-48 rounded bg-muted animate-pulse mb-2" />
        <div className="h-[600px] rounded bg-muted animate-pulse" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1" data-testid="file-viewer">
      <p className="text-xs text-muted-foreground font-mono px-1 truncate" data-testid="file-viewer-path">
        {path}
      </p>
      <CodeMirror
        value={content}
        height="600px"
        extensions={extensions}
        theme={dark ? 'dark' : 'light'}
        readOnly={true}
        basicSetup={{ lineNumbers: true }}
        data-testid="file-viewer-codemirror"
      />
    </div>
  )
}
