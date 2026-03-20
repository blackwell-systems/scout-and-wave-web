import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { go } from '@codemirror/lang-go'

interface MarkdownContentProps {
  children: string
  compact?: boolean  // default true for review panels, false for chat
}

/** Guess language from code content when no fence tag is provided. */
function guessLanguage(code: string): string | null {
  const trimmed = code.trimStart()

  // Go: keywords, operators, patterns - check first 3 lines for better detection
  const first3 = code.split('\n').slice(0, 3).join('\n')
  if (
    // Go keywords at line start (after optional comment)
    /^(\/\/.*\n)?(type |func |package |import |var |const |defer |go |return |struct |interface \{)/.test(trimmed) ||
    // Go patterns anywhere in first 3 lines
    /(^|\n)(type |func |package |struct |interface \{)/.test(first3) ||
    /\s:=\s|func\s+\(.*\)\s+\w+|<-\s*chan|chan\s+/.test(first3) ||
    /\berr\s+:=|if\s+err\s+!=\s+nil|`yaml:|`json:/.test(code)
  ) return 'go'

  // TypeScript/JavaScript: broader patterns including common constructs
  if (
    /^(interface |export |import |type |const |let |var |async |function |class |@\w+|\/\/ @ts-)/.test(trimmed) ||
    /:\s*(string|number|boolean|any|void|Promise|unknown)\b/.test(first3) ||
    /=>\s*\{|<\w+>/.test(first3)
  ) return 'typescript'

  // Python: def/class/import, decorators, type hints
  if (
    /^(def |class |from |import |async def |@\w+)/.test(trimmed) ||
    /->\s*\w+:|:\s*\w+\s*=/.test(first3)
  ) return 'python'

  // Rust: keywords and syntax patterns
  if (
    /^(fn |pub |use |struct |impl |mod |let |const |enum |trait |unsafe |extern )/.test(trimmed) ||
    /&(mut\s+)?\w+|::\w+|<'/.test(first3)
  ) return 'rust'

  // YAML: key: value pattern, list items
  if (/^(\w[\w-]*:\s|[-*]\s+\w+:|  )/.test(trimmed) && !/^\s*\{/.test(trimmed)) return 'yaml'

  // JSON: starts with { or [ and contains valid JSON structure
  if (/^[{\[]/.test(trimmed) && /":\s*[{\["']/.test(code)) return 'json'

  // Shell: prompts, shebangs, common commands
  if (
    /^(\$\s|#!\/|cd |mkdir |npm |go |git |cargo |docker |kubectl |curl |wget |echo |export |source |chmod )/.test(trimmed) ||
    /\|\s*(grep|sed|awk|xargs)|&&|\|\|/.test(code)
  ) return 'bash'

  return null
}

/** Map a language identifier to a CodeMirror language extension. */
function getLanguageExtension(lang: string) {
  switch (lang) {
    case 'go':
      return go()
    case 'typescript':
    case 'tsx':
      return javascript({ typescript: true, jsx: lang === 'tsx' })
    case 'javascript':
    case 'jsx':
    case 'js':
    case 'ts':
      return javascript({ typescript: lang === 'ts', jsx: false })
    case 'python':
    case 'py':
      return python()
    default:
      return null
  }
}

/** Read-only CodeMirror block for fenced code in markdown. */
function CodeBlock({ code, lang, isDark }: { code: string; lang: string; isDark: boolean }): JSX.Element {
  const extensions = useMemo(() => {
    const ext = getLanguageExtension(lang)
    return ext ? [ext] : []
  }, [lang])

  return (
    <CodeMirror
      value={code}
      extensions={extensions}
      theme={isDark ? 'dark' : 'light'}
      readOnly={true}
      editable={false}
      basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
      style={{ fontSize: '0.75rem', borderRadius: '0.375rem', margin: '0.5rem 0' }}
    />
  )
}

export default function MarkdownContent({ children, compact = true }: MarkdownContentProps): JSX.Element {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'))
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className={`prose prose-sm dark:prose-invert max-w-none
        prose-headings:text-sm prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
        prose-p:text-xs prose-p:leading-relaxed
        prose-li:text-xs
        prose-strong:text-foreground
        prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
        ${compact
          ? 'prose-p:my-1 prose-li:my-0 prose-ul:my-1 prose-ol:my-1'
          : '[&>*]:mb-4 [&_p]:mb-4 [&_p]:block'
        }
      `}
    >
      <ReactMarkdown
        components={{
          code({ className, children: codeChildren, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const code = String(codeChildren).replace(/\n$/, '')
            const isBlock = code.includes('\n')
            // Use explicit language, or auto-detect for multi-line code blocks
            const lang = match?.[1] ?? (isBlock ? guessLanguage(code) : null)
            if (lang) {
              return <CodeBlock code={code} lang={lang} isDark={isDark} />
            }
            return (
              <code className={className} {...props}>
                {codeChildren}
              </code>
            )
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
