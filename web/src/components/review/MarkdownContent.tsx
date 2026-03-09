import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface MarkdownContentProps {
  children: string
  compact?: boolean  // default true for review panels, false for chat
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

  const spacingClasses = compact
    ? 'prose-p:my-1 prose-li:my-0 prose-ul:my-1 prose-ol:my-1'
    : 'prose-p:my-4 prose-p:block prose-li:my-1 prose-ul:my-3 prose-ol:my-3'

  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none
      prose-headings:text-sm prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
      prose-p:text-xs prose-p:leading-relaxed
      prose-li:text-xs
      prose-strong:text-foreground
      prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
      ${spacingClasses}
    `}>
      <ReactMarkdown
        components={{
          code({ className, children: codeChildren, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const code = String(codeChildren).replace(/\n$/, '')
            if (match) {
              return (
                <SyntaxHighlighter
                  language={match[1]}
                  style={isDark ? vscDarkPlus : vs}
                  customStyle={{
                    fontSize: '0.75rem',
                    borderRadius: '0.375rem',
                    margin: '0.5rem 0',
                  }}
                >
                  {code}
                </SyntaxHighlighter>
              )
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
