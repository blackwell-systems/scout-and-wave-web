import {
  PipelineResponse,
  QueueItem,
  AddQueueItemRequest,
  AutonomyConfig,
  DaemonState,
} from './types/autonomy'

/**
 * Autonomy API client for pipeline, queue, and daemon management.
 * Created by Agent F (wave 2).
 *
 * Follows the same error-handling pattern as api.ts:
 *   if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
 */

// --- Pipeline ---

// GET /api/pipeline
export async function fetchPipeline(): Promise<PipelineResponse> {
  const r = await fetch('/api/pipeline')
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<PipelineResponse>
}

// --- Queue ---

// GET /api/queue
export async function fetchQueue(): Promise<QueueItem[]> {
  const r = await fetch('/api/queue')
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<QueueItem[]>
}

// POST /api/queue
export async function addQueueItem(req: AddQueueItemRequest): Promise<QueueItem> {
  const r = await fetch('/api/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<QueueItem>
}

// DELETE /api/queue/{slug}
export async function deleteQueueItem(slug: string): Promise<void> {
  const r = await fetch(`/api/queue/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

// PUT /api/queue/{slug}/priority
export async function updateQueuePriority(slug: string, priority: number): Promise<void> {
  const r = await fetch(`/api/queue/${encodeURIComponent(slug)}/priority`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

// --- Autonomy config ---

// GET /api/autonomy
export async function fetchAutonomy(): Promise<AutonomyConfig> {
  const r = await fetch('/api/autonomy')
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<AutonomyConfig>
}

// PUT /api/autonomy
export async function saveAutonomy(config: AutonomyConfig): Promise<void> {
  const r = await fetch('/api/autonomy', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

// --- Daemon control ---

// POST /api/daemon/start
export async function startDaemon(): Promise<DaemonState> {
  const r = await fetch('/api/daemon/start', { method: 'POST' })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<DaemonState>
}

// POST /api/daemon/stop
export async function stopDaemon(): Promise<void> {
  const r = await fetch('/api/daemon/stop', { method: 'POST' })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

// GET /api/daemon/status
export async function fetchDaemonStatus(): Promise<DaemonState> {
  const r = await fetch('/api/daemon/status')
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<DaemonState>
}

// GET /api/daemon/events — SSE stream for daemon events
// (pipeline_updated events are broadcast by queue and daemon handlers when state changes)
export function subscribeDaemonEvents(): EventSource {
  return new EventSource('/api/daemon/events')
}
