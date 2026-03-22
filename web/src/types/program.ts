// TypeScript types for the program layer API
// Mirrors Go SDK protocol types from github.com/blackwell-systems/scout-and-wave-go/pkg/protocol

import type { ImplReference, PipelineMetrics, PipelineEntry } from './autonomy'

export interface ProgramStatus {
  program_slug: string
  title: string
  state: string
  current_tier: number
  tier_statuses: TierStatus[]
  contract_statuses: ContractStatus[]
  completion: ProgramCompletion
  is_executing: boolean
}

export interface TierStatus {
  number: number
  description: string
  impl_statuses: ImplTierStatus[]
  complete: boolean
}

export interface ImplAgentInfo {
  id: string
  status: string  // 'pending' | 'running' | 'complete' | 'failed'
  dependencies?: string[]
}

export interface ImplWaveInfo {
  number: number
  agents: ImplAgentInfo[]
}

export interface ImplTierStatus extends ImplReference {
  // slug, title, status inherited from ImplReference
  wave_progress?: string  // e.g. "Wave 2/3" emitted via program_impl_wave_progress SSE (U3)
  waves?: ImplWaveInfo[]
}

export interface ContractStatus {
  name: string
  location: string
  freeze_at: string
  frozen: boolean
  frozen_at_tier?: number
}

export interface ProgramCompletion {
  tiers_complete: number
  tiers_total: number
  impls_complete: number
  impls_total: number
  total_agents: number
  total_waves: number
}

export interface ProgramDiscovery {
  path: string
  slug: string
  state: string
  title: string
}

export interface ProgramListResponse {
  programs: ProgramDiscovery[]
  metrics: PipelineMetrics
  standalone: PipelineEntry[]
}

// --- Create-from-IMPLs types ---

export interface IMPLFileConflict {
  file: string
  impls: string[]
  repos?: string[]
}

export interface ConflictReport {
  conflicts: IMPLFileConflict[]
  disjoint_sets: string[][]
  tier_suggestion: Record<string, number>
}

export interface GenerateProgramResult {
  manifest_path: string
  conflict_report: ConflictReport
  tier_assignments: Record<string, number>
  manifest: any
  validation_errors?: any[]
}
