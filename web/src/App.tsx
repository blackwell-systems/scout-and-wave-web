import { useState, useEffect } from 'react'
import { listImpls, fetchImpl, approveImpl, rejectImpl, startWave } from './api'
import { IMPLDocResponse } from './types'
import ReviewScreen from './components/ReviewScreen'
import WaveBoard from './components/WaveBoard'
import DarkModeToggle from './components/DarkModeToggle'

type Screen = 'input' | 'review' | 'wave'

export default function App() {
  const [slug, setSlug] = useState('')
  const [slugs, setSlugs] = useState<string[]>([])
  const [screen, setScreen] = useState<Screen>('input')
  const [impl, setImpl] = useState<IMPLDocResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejected, setRejected] = useState(false)

  useEffect(() => {
    listImpls().then(setSlugs).catch(() => {})
  }, [])

  async function handleSelect(selected: string) {
    setSlug(selected)
    setLoading(true)
    setError(null)
    try {
      const data = await fetchImpl(selected)
      setImpl(data)
      setScreen('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleLoad(e: React.FormEvent) {
    e.preventDefault()
    await handleSelect(slug)
  }

  async function handleApprove() {
    setLoading(true)
    setError(null)
    try {
      await approveImpl(slug)
      try {
        await startWave(slug)
      } catch (startErr) {
        // Swallow 409 (already running) and other start errors — still transition to wave screen
        const msg = startErr instanceof Error ? startErr.message : String(startErr)
        if (!msg.includes('409')) {
          console.warn('startWave error (non-fatal):', msg)
        }
      }
      setScreen('wave')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleReject() {
    setLoading(true)
    setError(null)
    try {
      await rejectImpl(slug)
      setRejected(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  if (screen === 'wave') {
    return (
      <>
        <div className="fixed top-4 right-4 z-50">
          <DarkModeToggle />
        </div>
        <WaveBoard slug={slug} />
      </>
    )
  }

  if (screen === 'review' && impl !== null) {
    return (
      <>
        <div className="fixed top-4 right-4 z-50">
          <DarkModeToggle />
        </div>
        <ReviewScreen
          slug={slug}
          impl={impl}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      </>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="fixed top-4 right-4 z-50">
        <DarkModeToggle />
      </div>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-md p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Scout and Wave</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">Select a plan to review.</p>

        {slugs.length > 0 && (
          <div className="space-y-2 mb-6">
            {slugs.map(s => (
              <button
                key={s}
                onClick={() => handleSelect(s)}
                disabled={loading}
                className="w-full text-left border border-gray-200 dark:border-gray-700 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-gray-800 rounded-lg px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {slugs.length === 0 && (
          <p className="text-gray-400 dark:text-gray-500 text-sm mb-6">No IMPL docs found. Run <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">saw scout</code> first.</p>
        )}

        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <p className="text-gray-400 dark:text-gray-500 text-xs mb-2">Or enter a slug manually:</p>
          <form onSubmit={handleLoad} className="flex gap-2">
            <input
              type="text"
              value={slug}
              onChange={e => setSlug(e.target.value)}
              placeholder="e.g. caching-layer"
              className="flex-1 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
            >
              {loading ? '...' : 'Go'}
            </button>
          </form>
        </div>

        {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
        {rejected && <p className="text-orange-600 text-sm mt-3">Plan rejected.</p>}
      </div>
    </div>
  )
}
