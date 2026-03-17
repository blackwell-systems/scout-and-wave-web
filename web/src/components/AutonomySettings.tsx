import { useState, useEffect } from 'react'
import { AutonomyConfig, AutonomyLevel } from '../types/autonomy'
import { fetchAutonomy, saveAutonomy } from '../autonomyApi'
import { Button } from './ui/button'

export default function AutonomySettings(): JSX.Element {
  const [config, setConfig] = useState<AutonomyConfig>({
    level: 'gated',
    max_auto_retries: 3,
    max_queue_depth: 10,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState(false)

  useEffect(() => {
    fetchAutonomy()
      .then(cfg => {
        setConfig(cfg)
        setLoading(false)
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await saveAutonomy(config)
      setSavedMsg(true)
      setTimeout(() => setSavedMsg(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        Loading autonomy settings...
      </div>
    )
  }

  const levelDescriptions: Record<AutonomyLevel, string> = {
    gated: 'Manual approval required for each wave. Maximum control, slowest execution.',
    supervised: 'Waves run automatically with human review checkpoints. Balanced approach.',
    autonomous: 'Fully automated execution with no manual gates. Fastest, least oversight.',
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-4">
      <h3 className="text-sm font-medium">Autonomy Level</h3>

      {error && (
        <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
          {error}
        </div>
      )}

      {/* Autonomy level selector */}
      <div className="flex flex-col gap-2">
        <label htmlFor="autonomy-level" className="text-xs text-muted-foreground">
          Execution Mode
        </label>
        <select
          id="autonomy-level"
          value={config.level}
          onChange={e => setConfig(c => ({ ...c, level: e.target.value as AutonomyLevel }))}
          className="text-sm px-3 py-2 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
        >
          <option value="gated">Gated (Manual)</option>
          <option value="supervised">Supervised (Semi-Auto)</option>
          <option value="autonomous">Autonomous (Full Auto)</option>
        </select>
        <p className="text-xs text-muted-foreground">
          {levelDescriptions[config.level]}
        </p>
      </div>

      {/* Max auto retries */}
      <div className="flex flex-col gap-2">
        <label htmlFor="max-retries" className="text-xs text-muted-foreground">
          Max Auto Retries
        </label>
        <input
          id="max-retries"
          type="number"
          min="0"
          max="10"
          value={config.max_auto_retries}
          onChange={e => setConfig(c => ({ ...c, max_auto_retries: parseInt(e.target.value, 10) }))}
          className="text-sm px-3 py-2 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          Number of automatic retry attempts before requiring manual intervention.
        </p>
      </div>

      {/* Max queue depth */}
      <div className="flex flex-col gap-2">
        <label htmlFor="max-queue" className="text-xs text-muted-foreground">
          Max Queue Depth
        </label>
        <input
          id="max-queue"
          type="number"
          min="1"
          max="100"
          value={config.max_queue_depth}
          onChange={e => setConfig(c => ({ ...c, max_queue_depth: parseInt(e.target.value, 10) }))}
          className="text-sm px-3 py-2 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          Maximum number of items that can be queued for execution.
        </p>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3 justify-end pt-2">
        {savedMsg && (
          <span className="text-xs text-green-600 dark:text-green-400">Saved!</span>
        )}
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  )
}
