import { useState } from 'react'
import { WaveInfo } from '../types'
import { sawClient } from '../lib/apiClient'

interface AmendPanelProps {
  slug: string
  waves: WaveInfo[]
  onAmendComplete?: () => void
}

interface AmendResult {
  success: boolean
  operation: string
  new_wave_number?: number
  agent_id?: string
  warnings?: string[]
  error?: string
}

async function callAmend(slug: string, body: object): Promise<AmendResult> {
  return await sawClient.impl.amend(slug, body) as AmendResult
}

type TabKey = 'add-wave' | 'redirect-agent' | 'extend-scope'

export default function AmendPanel(props: AmendPanelProps): JSX.Element {
  const { slug, waves, onAmendComplete } = props

  const [activeTab, setActiveTab] = useState<TabKey>('add-wave')
  const [loading, setLoading] = useState(false)

  // Add Wave state
  const [addWaveMessage, setAddWaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Redirect Agent state
  const [selectedWaveNum, setSelectedWaveNum] = useState<number>(waves[0]?.number ?? 1)
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const [newTask, setNewTask] = useState('')
  const [redirectMessage, setRedirectMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Extend Scope state
  const [extendMessage, setExtendMessage] = useState<{ type: 'info' | 'error'; text: string } | null>(null)

  const selectedWave = waves.find(w => w.number === selectedWaveNum)
  const agentsForWave = selectedWave?.agents ?? []

  function handleWaveChange(waveNum: number) {
    setSelectedWaveNum(waveNum)
    setSelectedAgentId('')
  }

  async function handleAddWave() {
    setLoading(true)
    setAddWaveMessage(null)
    try {
      const result = await callAmend(slug, { operation: 'add-wave' })
      if (result.success) {
        const waveNum = result.new_wave_number
        setAddWaveMessage({
          type: 'success',
          text: `Wave ${waveNum} appended. Reload to see updated wave structure.`,
        })
        onAmendComplete?.()
      } else {
        setAddWaveMessage({ type: 'error', text: result.error ?? 'Unknown error' })
      }
    } catch (err) {
      setAddWaveMessage({ type: 'error', text: String(err) })
    } finally {
      setLoading(false)
    }
  }

  async function handleRedirectAgent() {
    if (!selectedAgentId || !newTask.trim()) return
    setLoading(true)
    setRedirectMessage(null)
    try {
      const result = await callAmend(slug, {
        operation: 'redirect-agent',
        agent_id: selectedAgentId,
        wave_num: selectedWaveNum,
        new_task: newTask,
      })
      if (result.success) {
        setRedirectMessage({
          type: 'success',
          text: `Agent ${result.agent_id ?? selectedAgentId} redirected. New task saved.`,
        })
        onAmendComplete?.()
      } else {
        setRedirectMessage({ type: 'error', text: result.error ?? 'Unknown error' })
      }
    } catch (err) {
      setRedirectMessage({ type: 'error', text: String(err) })
    } finally {
      setLoading(false)
    }
  }

  async function handleExtendScope() {
    setLoading(true)
    setExtendMessage(null)
    try {
      const result = await callAmend(slug, { operation: 'extend-scope' })
      if (result.success) {
        const warningText = result.warnings?.join('\n') ?? 'Use /saw amend --extend-scope in Claude Code to re-engage Scout.'
        setExtendMessage({ type: 'info', text: warningText })
        onAmendComplete?.()
      } else {
        setExtendMessage({ type: 'error', text: result.error ?? 'Unknown error' })
      }
    } catch (err) {
      setExtendMessage({ type: 'error', text: String(err) })
    } finally {
      setLoading(false)
    }
  }

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'add-wave', label: 'Add Wave' },
    { key: 'redirect-agent', label: 'Redirect Agent' },
    { key: 'extend-scope', label: 'Extend Scope' },
  ]

  return (
    <div className="p-4">
      {/* Tab bar */}
      <div className="flex gap-2 border-b mb-4">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={
              activeTab === tab.key
                ? 'pb-2 border-b-2 border-blue-500 text-blue-600 font-medium text-sm'
                : 'pb-2 text-gray-500 hover:text-gray-700 text-sm'
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Add Wave tab */}
      {activeTab === 'add-wave' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Append a new empty wave skeleton to the IMPL manifest. The new wave will have no
            agents yet — use Scout to populate it.
          </p>
          <button
            onClick={handleAddWave}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Appending…' : 'Append New Wave'}
          </button>
          {addWaveMessage && (
            <div
              className={
                addWaveMessage.type === 'success'
                  ? 'bg-green-50 text-green-700 rounded p-2 text-sm'
                  : 'bg-red-50 text-red-700 rounded p-2 text-sm'
              }
            >
              {addWaveMessage.text}
            </div>
          )}
        </div>
      )}

      {/* Redirect Agent tab */}
      {activeTab === 'redirect-agent' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Re-queue an agent with a new task. This clears the agent's completion report so it
            can be re-run.
          </p>

          <div className="flex gap-4">
            {/* Wave selector */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-700">Wave</label>
              <select
                value={selectedWaveNum}
                onChange={e => handleWaveChange(Number(e.target.value))}
                className="border rounded px-2 py-1 text-sm"
              >
                {waves.map(w => (
                  <option key={w.number} value={w.number}>
                    Wave {w.number}
                  </option>
                ))}
              </select>
            </div>

            {/* Agent selector */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-700">Agent</label>
              <select
                value={selectedAgentId}
                onChange={e => setSelectedAgentId(e.target.value)}
                className="border rounded px-2 py-1 text-sm"
                disabled={agentsForWave.length === 0}
              >
                <option value="">-- select agent --</option>
                {agentsForWave.map(agent => (
                  <option key={agent} value={agent}>
                    {agent}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* New task textarea */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-700">New Task</label>
            <textarea
              value={newTask}
              onChange={e => setNewTask(e.target.value)}
              rows={6}
              placeholder="Describe the new task for this agent…"
              className="border rounded px-2 py-1 text-sm w-full font-mono"
            />
          </div>

          <button
            onClick={handleRedirectAgent}
            disabled={loading || !selectedAgentId || !newTask.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Redirecting…' : 'Redirect Agent'}
          </button>

          {redirectMessage && (
            <div
              className={
                redirectMessage.type === 'success'
                  ? 'bg-green-50 text-green-700 rounded p-2 text-sm'
                  : 'bg-red-50 text-red-700 rounded p-2 text-sm'
              }
            >
              {redirectMessage.text}
            </div>
          )}
        </div>
      )}

      {/* Extend Scope tab */}
      {activeTab === 'extend-scope' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Re-engage Scout with the current IMPL as context to add new waves. This is an
            orchestrator-level operation — use{' '}
            <code className="bg-gray-100 px-1 rounded text-xs">/saw amend --extend-scope</code>{' '}
            in Claude Code.
          </p>

          <button
            onClick={handleExtendScope}
            disabled={loading}
            className="px-4 py-2 bg-yellow-600 text-white rounded text-sm hover:bg-yellow-700 disabled:opacity-50"
          >
            {loading ? 'Sending…' : 'Mark for Extend Scope'}
          </button>

          {extendMessage && (
            <div
              className={
                extendMessage.type === 'info'
                  ? 'bg-yellow-50 text-yellow-700 rounded p-2 text-sm whitespace-pre-wrap'
                  : 'bg-red-50 text-red-700 rounded p-2 text-sm'
              }
            >
              {extendMessage.text}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
