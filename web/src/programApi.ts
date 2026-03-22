// @deprecated — Use sawClient from lib/apiClient.ts instead.
// This file re-exports all functions as thin wrappers over sawClient.program
// so existing imports continue to work without breaking anything.

import { sawClient } from './lib/apiClient'
import type {
  ProgramDiscovery,
  ProgramListResponse,
  ProgramStatus,
  TierStatus,
  ContractStatus,
  ConflictReport,
  GenerateProgramResult,
} from './types/program'

// ── IMPL Branch Lifecycle SSE Event Types ───────────────────────────────────

/** SSE event emitted when an IMPL branch is created for tier execution. */
export interface ImplBranchCreatedEvent {
  type: 'impl_branch_created'
  payload: {
    tier: number
    impl_slug: string
    branch: string
  }
}

/** SSE event emitted when an IMPL branch is merged after tier completion. */
export interface ImplBranchMergedEvent {
  type: 'impl_branch_merged'
  payload: {
    tier: number
    impl_slug: string
    branch: string
    merge_commit: string
  }
}

/** Union of all IMPL branch lifecycle SSE events. */
export type ImplBranchEvent = ImplBranchCreatedEvent | ImplBranchMergedEvent

/** Union of all tier execution SSE event types (existing + IMPL branch events). */
export type TierExecutionEvent =
  | { type: 'program_tier_started'; program_slug: string; tier: number }
  | { type: 'program_tier_complete'; program_slug: string; tier: number }
  | { type: 'program_impl_started'; program_slug: string; impl_slug: string }
  | { type: 'program_impl_complete'; program_slug: string; impl_slug: string }
  | { type: 'program_complete'; program_slug: string }
  | { type: 'program_blocked'; program_slug: string; reason: string }
  | ImplBranchCreatedEvent
  | ImplBranchMergedEvent

/**
 * Fetch the full program list response including metrics and standalone IMPLs.
 * Prefer this over `listPrograms` for new code.
 */
export async function listProgramsFull(): Promise<ProgramListResponse> {
  const r = await fetch('/api/programs')
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  }
  return r.json() as Promise<ProgramListResponse>
}

/** @deprecated Use `listProgramsFull` for access to metrics and standalone IMPLs. */
export async function listPrograms(): Promise<ProgramDiscovery[]> {
  const resp = await listProgramsFull()
  return resp.programs
}

export async function fetchProgramStatus(slug: string): Promise<ProgramStatus> {
  return sawClient.program.status(slug)
}

export async function fetchTierStatus(slug: string, tier: number): Promise<TierStatus> {
  return sawClient.program.tierStatus(slug, tier)
}

export async function executeTier(slug: string, tier: number, auto?: boolean): Promise<void> {
  return sawClient.program.executeTier(slug, tier, auto)
}

export async function fetchProgramContracts(slug: string): Promise<ContractStatus[]> {
  return sawClient.program.contracts(slug)
}

export async function replanProgram(slug: string): Promise<void> {
  return sawClient.program.replan(slug)
}

// ── Planner API ──────────────────────────────────────────────────────────────

export async function runPlanner(
  description: string,
  repo?: string,
): Promise<{ runId: string }> {
  return sawClient.program.runPlanner(description, repo)
}

export function subscribePlannerEvents(runId: string): EventSource {
  return sawClient.program.subscribePlannerEvents(runId)
}

export async function cancelPlanner(runId: string): Promise<void> {
  return sawClient.program.cancelPlanner(runId)
}

export async function analyzeImpls(slugs: string[], repo?: string): Promise<ConflictReport> {
  return sawClient.program.analyzeImpls(slugs, repo)
}

export async function createProgramFromImpls(
  slugs: string[],
  name?: string,
  programSlug?: string,
  repo?: string,
): Promise<GenerateProgramResult> {
  return sawClient.program.createFromImpls(slugs, name, programSlug, repo)
}

// ── IMPL Branch SSE Helpers ─────────────────────────────────────────────────

/**
 * Register IMPL branch lifecycle event listeners on a program EventSource.
 *
 * This attaches handlers for `impl_branch_created` and `impl_branch_merged`
 * SSE events, filtering by the given program slug. The callback receives
 * a typed ImplBranchEvent so consumers can update UI state (e.g. showing
 * the active IMPL branch name or merge status on a tier detail view).
 *
 * Usage (in a component that already has a program EventSource):
 *   const es = new EventSource('/api/program/events')
 *   const detach = attachImplBranchListeners(es, programSlug, (evt) => {
 *     // update state with evt.payload.branch, evt.payload.merge_commit, etc.
 *   })
 *   // on cleanup:
 *   detach()
 */
export function attachImplBranchListeners(
  eventSource: EventSource,
  programSlug: string,
  onEvent: (event: ImplBranchEvent) => void,
): () => void {
  const handleCreated = (e: MessageEvent) => {
    const data = JSON.parse(e.data)
    if (data.program_slug === programSlug) {
      onEvent({
        type: 'impl_branch_created',
        payload: {
          tier: data.tier,
          impl_slug: data.impl_slug,
          branch: data.branch,
        },
      })
    }
  }

  const handleMerged = (e: MessageEvent) => {
    const data = JSON.parse(e.data)
    if (data.program_slug === programSlug) {
      onEvent({
        type: 'impl_branch_merged',
        payload: {
          tier: data.tier,
          impl_slug: data.impl_slug,
          branch: data.branch,
          merge_commit: data.merge_commit,
        },
      })
    }
  }

  eventSource.addEventListener('impl_branch_created', handleCreated)
  eventSource.addEventListener('impl_branch_merged', handleMerged)

  // Return detach function for cleanup
  return () => {
    eventSource.removeEventListener('impl_branch_created', handleCreated)
    eventSource.removeEventListener('impl_branch_merged', handleMerged)
  }
}
