// TypeScript types for the program layer API
// Mirrors Go SDK protocol types from github.com/blackwell-systems/scout-and-wave-go/pkg/protocol

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

export interface ImplTierStatus {
  slug: string
  status: string
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
