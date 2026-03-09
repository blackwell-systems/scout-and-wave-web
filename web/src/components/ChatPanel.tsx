import { useState, useRef, useEffect } from 'react'
import { useChatWithClaude } from '../hooks/useChatWithClaude'
import MarkdownContent from './review/MarkdownContent'

interface ChatPanelProps {
  slug: string
  onClose: () => void
}

export default function ChatPanel({ slug, onClose }: ChatPanelProps): JSX.Element {
  const { state, sendMessage } = useChatWithClaude(slug)
  const [input, setInput] = useState('')
  const [copied, setCopied] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.messages])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || state.running) return
    setInput('')
    await sendMessage(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const lastAssistantContent = (() => {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === 'assistant') return state.messages[i].content
    }
    return null
  })()

  const handleCopy = () => {
    if (lastAssistantContent) {
      navigator.clipboard.writeText(lastAssistantContent).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Ask Claude about this IMPL</h2>
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            &times; Close
          </button>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {state.messages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center mt-4">
              Ask a question about this plan or IMPL doc.
            </p>
          )}
          {state.messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'user' ? (
                <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 max-w-[75%] text-sm whitespace-pre-wrap">
                  {msg.content}
                </div>
              ) : (
                <div className="bg-secondary text-secondary-foreground rounded-lg px-3 py-2 max-w-[85%]">
                  {msg.content ? (
                    <MarkdownContent compact={false}>{msg.content}</MarkdownContent>
                  ) : state.running ? (
                    <span className="animate-pulse text-muted-foreground text-sm">thinking...</span>
                  ) : null}
                </div>
              )}
            </div>
          ))}

          {/* Copy button after last assistant message when not running */}
          {!state.running && lastAssistantContent && (
            <div className="flex justify-start pl-1">
              <button
                onClick={handleCopy}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}

          {state.error && (
            <div className="text-xs text-red-500 px-2">{state.error}</div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="flex items-stretch h-12 border-t border-border">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={state.running}
            placeholder="Ask something about this plan..."
            className="flex-1 text-sm px-4 bg-background text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={state.running || !input.trim()}
            className="flex items-center justify-center text-sm font-medium px-6 transition-colors border-l bg-violet-50/60 hover:bg-violet-100/80 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:hover:bg-violet-900/60 dark:text-violet-400 dark:border-violet-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
    </div>
  )
}
