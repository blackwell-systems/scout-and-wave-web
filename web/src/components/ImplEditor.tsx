import { useState, useEffect, useCallback } from 'react'
import { sawClient } from '../lib/apiClient'

interface ImplEditorProps {
  slug: string
}

export default function ImplEditor({ slug }: ImplEditorProps): JSX.Element {
  const [content, setContent] = useState<string>('')
  const [savedContent, setSavedContent] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const loadContent = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const text = await sawClient.impl.getRaw(slug)
      setContent(text)
      setSavedContent(text)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    loadContent()
  }, [loadContent])

  const isDirty = content !== savedContent

  async function handleSave() {
    setSaveStatus('saving')
    setSaveError(null)
    try {
      await sawClient.impl.saveRaw(slug, content)
      setSavedContent(content)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      setSaveStatus('error')
    }
  }

  function handleRevert() {
    setContent(savedContent)
    setSaveStatus('idle')
    setSaveError(null)
  }

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 text-gray-400 text-sm font-mono">
        Loading...
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-3">
        <p className="text-red-400 text-sm font-mono">Failed to load IMPL doc: {loadError}</p>
        <button
          onClick={loadContent}
          className="px-3 py-1.5 text-xs font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 flex flex-col gap-2 p-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isDirty && saveStatus !== 'saved' && (
            <span className="text-amber-400 text-xs font-medium select-none">
              &#9679; Unsaved changes
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-green-400 text-xs font-medium select-none">
              Saved &#10003;
            </span>
          )}
          {saveStatus === 'error' && saveError && (
            <span className="text-red-400 text-xs font-medium select-none truncate max-w-xs">
              {saveError}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRevert}
            disabled={!isDirty || saveStatus === 'saving'}
            className="px-3 py-1 text-xs font-medium bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-gray-300 rounded transition-colors"
          >
            Revert
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty || saveStatus === 'saving'}
            className="px-3 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded transition-colors"
          >
            {saveStatus === 'saving' ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Editor */}
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        spellCheck={false}
        className="w-full bg-gray-900 text-gray-100 font-mono text-sm rounded border border-gray-700 focus:border-gray-500 focus:outline-none resize-y p-3 leading-relaxed"
        style={{ minHeight: '400px' }}
      />
    </div>
  )
}
