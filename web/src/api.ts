import { IMPLDocResponse, IMPLListEntry } from './types'

export async function listImpls(): Promise<IMPLListEntry[]> {
  const response = await fetch('/api/impl')
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json() as Promise<IMPLListEntry[]>
}

export async function fetchImpl(slug: string): Promise<IMPLDocResponse> {
  const response = await fetch(`/api/impl/${encodeURIComponent(slug)}`)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json() as Promise<IMPLDocResponse>
}

export async function approveImpl(slug: string): Promise<void> {
  const response = await fetch(`/api/impl/${encodeURIComponent(slug)}/approve`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
}

export async function rejectImpl(slug: string): Promise<void> {
  const response = await fetch(`/api/impl/${encodeURIComponent(slug)}/reject`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
}

export async function startWave(slug: string): Promise<void> {
  const response = await fetch(`/api/wave/${encodeURIComponent(slug)}/start`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
}

export async function runScout(feature: string, repo?: string): Promise<{ runId: string }> {
  const r = await fetch('/api/scout/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature, repo }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = await r.json()
  return { runId: data.run_id }
}

export function subscribeScoutEvents(runId: string): EventSource {
  return new EventSource(`/api/scout/${encodeURIComponent(runId)}/events`)
}
