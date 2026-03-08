import { useState, useRef, useEffect } from 'react'
import { useChatWithClaude } from '../hooks/useChatWithClaude'

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
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 shadow-xl rounded-lg w-full max-w-2xl flex flex-col" style={{ maxHeight: '80vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold">Ask Claude about this IMPL</h2>
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
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
              <div
                className={
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-lg px-3 py-2 max-w-[75%] text-sm whitespace-pre-wrap'
                    : 'bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2 max-w-[85%] text-sm whitespace-pre-wrap'
                }
              >
                {msg.content || (msg.role === 'assistant' && state.running ? (
                  <span className="animate-pulse text-gray-400">thinking...</span>
                ) : null)}
              </div>
            </div>
          ))}

          {/* Copy button after last assistant message when not running */}
          {!state.running && lastAssistantContent && (
            <div className="flex justify-start pl-1">
              <button
                onClick={handleCopy}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
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
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={state.running}
            placeholder="Ask something about this plan..."
            className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded px-3 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={state.running || !input.trim()}
            className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
