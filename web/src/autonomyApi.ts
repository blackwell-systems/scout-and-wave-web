import {
  PipelineResponse,
  QueueItem,
  AddQueueItemRequest,
  AutonomyConfig,
  DaemonState,
} from './types/autonomy'

// Pipeline
export async function fetchPipeline(): Promise<PipelineResponse> {
  const r = await fetch('/api/pipeline')
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<PipelineResponse>
}

// Queue
export async function fetchQueue(): Promise<QueueItem[]> {
  const r = await fetch('/api/queue')
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<QueueItem[]>
}

export async function addQueueItem(req: AddQueueItemRequest): Promise<QueueItem> {
  const r = await fetch('/api/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<QueueItem>
}

export async function deleteQueueItem(slug: string): Promise<void> {
  const r = await fetch(`/api/queue/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

export async function updateQueuePriority(slug: string, priority: number): Promise<void> {
  const r = await fetch(`/api/queue/${encodeURIComponent(slug)}/priority`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

// Autonomy config
export async function fetchAutonomy(): Promise<AutonomyConfig> {
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

// Daemon control
export async function startDaemon(): Promise<DaemonState> {
  const r = await fetch('/api/daemon/start', {
    method: 'POST',
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<DaemonState>
}

export async function stopDaemon(): Promise<void> {
  const r = await fetch('/api/daemon/stop', {
    method: 'POST',
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
}

export async function fetchDaemonStatus(): Promise<DaemonState> {
  const r = await fetch('/api/daemon/status')
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  return r.json() as Promise<DaemonState>
}

export function subscribeDaemonEvents(): EventSource {
  return new EventSource('/api/daemon/events')
}
