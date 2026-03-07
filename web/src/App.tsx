import { useState } from 'react'
import { fetchImpl, approveImpl, rejectImpl } from './api'
import { IMPLDocResponse } from './types'
import ReviewScreen from './components/ReviewScreen'
import WaveBoard from './components/WaveBoard'

type Screen = 'input' | 'review' | 'wave'

export default function App() {
  const [slug, setSlug] = useState('')
  const [screen, setScreen] = useState<Screen>('input')
  const [impl, setImpl] = useState<IMPLDocResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejected, setRejected] = useState(false)

  async function handleLoad(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const data = await fetchImpl(slug)
      setImpl(data)
      setScreen('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleApprove() {
    setLoading(true)
    setError(null)
    try {
      await approveImpl(slug)
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
    return <WaveBoard slug={slug} />
  }

  if (screen === 'review' && impl !== null) {
    return (
      <ReviewScreen
        slug={slug}
        impl={impl}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Scout and Wave</h1>
        <p className="text-gray-500 text-sm mb-6">Enter an IMPL slug to review the plan.</p>
        <form onSubmit={handleLoad} className="space-y-4">
          <input
            type="text"
            value={slug}
            onChange={e => setSlug(e.target.value)}
            placeholder="e.g. caching-layer"
            className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          {error && (
            <p className="text-red-600 text-sm">{error}</p>
          )}
          {rejected && (
            <p className="text-orange-600 text-sm">Plan rejected.</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {loading ? 'Loading...' : 'Load Plan'}
          </button>
        </form>
      </div>
    </div>
  )
}
