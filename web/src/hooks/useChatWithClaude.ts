import { useState, useCallback, useEffect, useRef } from 'react'
import { startImplChat, subscribeChatEvents } from '../api'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatState {
  messages: ChatMessage[]
  running: boolean
  error?: string
}

// Global chat history storage (persists per IMPL across component unmount/remount)
const chatHistoryMap = new Map<string, ChatState>()

export function useChatWithClaude(slug: string): {
  state: ChatState
  sendMessage: (text: string) => Promise<void>
  clearHistory: () => void
} {
  // Load existing history for this slug, or start fresh
  const [state, setState] = useState<ChatState>(() =>
    chatHistoryMap.get(slug) || { messages: [], running: false }
  )

  const prevSlugRef = useRef(slug)

  // When slug changes, save current state and load the new slug's history
  useEffect(() => {
    if (prevSlugRef.current !== slug) {
      // Save the previous slug's state before switching
      chatHistoryMap.set(prevSlugRef.current, state)

      // Load the new slug's history (or start fresh)
      const newState = chatHistoryMap.get(slug) || { messages: [], running: false }
      setState(newState)

      prevSlugRef.current = slug
    }
  }, [slug, state])

  const sendMessage = useCallback(async (text: string) => {
    setState(prev => ({
      ...prev,
      running: true,
      error: undefined,
      messages: [
        ...prev.messages,
        { role: 'user', content: text },
        { role: 'assistant', content: '' },
      ],
    }))

    try {
      // Capture history before adding the assistant placeholder
      const historySnapshot = state.messages.slice()
      historySnapshot.push({ role: 'user', content: text })

      const { runId } = await startImplChat(slug, text, state.messages)
      const es = subscribeChatEvents(slug, runId)

      es.addEventListener('chat_output', (e: MessageEvent) => {
        const data = JSON.parse(e.data) as { run_id: string; chunk: string }
        setState(prev => {
          const msgs = [...prev.messages]
          const lastIdx = msgs.length - 1
          if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
            msgs[lastIdx] = { ...msgs[lastIdx], content: msgs[lastIdx].content + data.chunk }
          }
          return { ...prev, messages: msgs }
        })
      })

      es.addEventListener('chat_complete', () => {
        setState(prev => ({ ...prev, running: false }))
        es.close()
      })

      es.addEventListener('chat_failed', (e: MessageEvent) => {
        const data = JSON.parse(e.data) as { run_id: string; error: string }
        setState(prev => ({ ...prev, running: false, error: data.error }))
        es.close()
      })

      es.onerror = () => {
        setState(prev => ({ ...prev, running: false, error: 'Connection lost' }))
        es.close()
      }
    } catch (err) {
      setState(prev => ({
        ...prev,
        running: false,
        error: err instanceof Error ? err.message : 'Failed to start chat',
      }))
    }
  }, [slug, state.messages])

  const clearHistory = useCallback(() => {
    setState({ messages: [], running: false })
  }, [])

  return { state, sendMessage, clearHistory }
}
