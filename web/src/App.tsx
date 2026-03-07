import { useState, useEffect } from 'react'
import { listImpls, fetchImpl, approveImpl, rejectImpl, startWave } from './api'
import { IMPLDocResponse, IMPLListEntry } from './types'
import ReviewScreen from './components/ReviewScreen'
import WaveBoard from './components/WaveBoard'
import DarkModeToggle from './components/DarkModeToggle'
import { Button } from './components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card'

type Screen = 'input' | 'review' | 'wave'

export default function App() {
  const [slug, setSlug] = useState('')
  const [entries, setEntries] = useState<IMPLListEntry[]>([])
  const [screen, setScreen] = useState<Screen>('input')
  const [impl, setImpl] = useState<IMPLDocResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejected, setRejected] = useState(false)

  useEffect(() => {
    listImpls().then(setEntries).catch(() => {})
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
          onRefreshImpl={handleSelect}
        />
      </>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="fixed top-4 right-4 z-50">
        <DarkModeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Scout and Wave</CardTitle>
          <p className="text-sm text-muted-foreground">Select a plan to review.</p>
        </CardHeader>
        <CardContent>
          {entries.length > 0 && (() => {
            const active = entries.filter(e => e.doc_status !== 'COMPLETE')
            const completed = entries.filter(e => e.doc_status === 'COMPLETE')
            return (
              <div className="space-y-2 mb-6">
                {active.map(e => (
                  <Button
                    key={e.slug}
                    onClick={() => handleSelect(e.slug)}
                    disabled={loading}
                    variant="outline"
                    className="w-full justify-start hover:bg-accent"
                  >
                    {e.slug}
                  </Button>
                ))}
                {completed.length > 0 && (
                  <>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground pt-2">Completed</p>
                    {completed.map(e => (
                      <Button
                        key={e.slug}
                        onClick={() => handleSelect(e.slug)}
                        disabled={loading}
                        variant="ghost"
                        className="w-full justify-start text-muted-foreground"
                      >
                        {e.slug}
                      </Button>
                    ))}
                  </>
                )}
              </div>
            )
          })()}

          {entries.length === 0 && (
            <p className="text-muted-foreground text-sm mb-6">No IMPL docs found. Run <code className="bg-muted px-1 rounded">saw scout</code> first.</p>
          )}

          <div className="border-t pt-4">
            <p className="text-muted-foreground text-xs mb-2">Or enter a slug manually:</p>
            <form onSubmit={handleLoad} className="flex gap-2">
              <input
                type="text"
                value={slug}
                onChange={e => setSlug(e.target.value)}
                placeholder="e.g. caching-layer"
                className="flex-1 border border-input bg-background text-foreground rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
              <Button type="submit" disabled={loading}>
                {loading ? '...' : 'Go'}
              </Button>
            </form>
          </div>

          {error && <p className="text-destructive text-sm mt-3">{error}</p>}
          {rejected && <p className="text-orange-600 text-sm mt-3">Plan rejected.</p>}
        </CardContent>
      </Card>
    </div>
  )
}
