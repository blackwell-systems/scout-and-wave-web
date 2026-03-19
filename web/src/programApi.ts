// API client functions for the program layer
// Follows the pattern from api.ts with type-safe fetch wrappers

import {
  ProgramDiscovery,
  ProgramStatus,
  TierStatus,
  ContractStatus,
} from './types/program'

export async function listPrograms(): Promise<ProgramDiscovery[]> {
  const response = await fetch('/api/programs')
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  const data = await response.json()
  return data.programs as ProgramDiscovery[]
}

export async function fetchProgramStatus(slug: string): Promise<ProgramStatus> {
  const response = await fetch(`/api/program/${encodeURIComponent(slug)}`)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json() as Promise<ProgramStatus>
}

export async function fetchTierStatus(slug: string, tier: number): Promise<TierStatus> {
  const response = await fetch(`/api/program/${encodeURIComponent(slug)}/tier/${tier}`)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json() as Promise<TierStatus>
}

export async function executeTier(slug: string, tier: number, auto?: boolean): Promise<void> {
  const response = await fetch(`/api/program/${encodeURIComponent(slug)}/tier/${tier}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auto: auto ?? false }),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
}

export async function fetchProgramContracts(slug: string): Promise<ContractStatus[]> {
  const response = await fetch(`/api/program/${encodeURIComponent(slug)}/contracts`)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json() as Promise<ContractStatus[]>
}

export async function replanProgram(slug: string): Promise<void> {
  const response = await fetch(`/api/program/${encodeURIComponent(slug)}/replan`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
}

// ── Planner API ──────────────────────────────────────────────────────────────

export async function runPlanner(
  description: string,
  repo?: string,
): Promise<{ runId: string }> {
  const response = await fetch('/api/planner/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, repo }),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  const data = await response.json() as { run_id: string }
  return { runId: data.run_id }
}

export function subscribePlannerEvents(runId: string): EventSource {
  return new EventSource(`/api/planner/${encodeURIComponent(runId)}/events`)
}

export async function cancelPlanner(runId: string): Promise<void> {
  await fetch(`/api/planner/${encodeURIComponent(runId)}/cancel`, { method: 'POST' })
}

// Program SSE event subscription
// Usage example:
//   const es = new EventSource('/api/program/events')
//   es.addEventListener('program_tier_complete', (e: MessageEvent) => {
//     const data = JSON.parse(e.data)
//     console.log('Tier complete:', data.program_slug, data.tier)
//   })
//
// Event types:
//   - program_tier_started:    {program_slug, tier}
//   - program_tier_complete:   {program_slug, tier}
//   - program_impl_started:    {program_slug, impl_slug}
//   - program_impl_complete:   {program_slug, impl_slug}
//   - program_contract_frozen: {program_slug, contract_name, tier}
//   - program_complete:        {program_slug}
//   - program_blocked:         {program_slug, reason, impl_slug?}
