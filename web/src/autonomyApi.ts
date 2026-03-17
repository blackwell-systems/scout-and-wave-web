import { PipelineResponse, QueueItem, AutonomyConfig, DaemonState } from './types/autonomy'

/**
 * Autonomy API client for pipeline, queue, and daemon management.
 * Created by Agent F (wave 2).
 */

// Pipeline endpoint - returns combined view of completed + executing + queued IMPLs
export async function fetchPipeline(): Promise<PipelineResponse> {
  const r = await fetch('/api/pipeline')
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<PipelineResponse>
}

// Queue endpoints
export async function listQueue(): Promise<QueueItem[]> {
  const r = await fetch('/api/queue')
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<QueueItem[]>
}

export async function addQueueItem(item: {
  title: string
  priority: number
  feature_description: string
  depends_on?: string[]
  autonomy_override?: string
  require_review?: boolean
}): Promise<void> {
  const r = await fetch('/api/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

export async function deleteQueueItem(slug: string): Promise<void> {
  const r = await fetch(`/api/queue/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

export async function reorderQueueItem(slug: string, priority: number): Promise<void> {
  const r = await fetch(`/api/queue/${encodeURIComponent(slug)}/priority`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

// Autonomy config endpoints
export async function getAutonomy(): Promise<AutonomyConfig> {
  const r = await fetch('/api/autonomy')
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<AutonomyConfig>
}

export async function saveAutonomy(config: AutonomyConfig): Promise<void> {
  const r = await fetch('/api/autonomy', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

// Daemon control endpoints
export async function startDaemon(): Promise<void> {
  const r = await fetch('/api/daemon/start', { method: 'POST' })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

export async function stopDaemon(): Promise<void> {
  const r = await fetch('/api/daemon/stop', { method: 'POST' })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

export async function getDaemonStatus(): Promise<DaemonState> {
  const r = await fetch('/api/daemon/status')
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<DaemonState>
}

// SSE stream for daemon events (pipeline_updated, impl_list_updated, etc.)
export function subscribeDaemonEvents(): EventSource {
  return new EventSource('/api/daemon/events')
}
