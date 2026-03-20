// TypeScript types matching the Protocol SDK's Go types
export interface IMPLManifest {
  title: string
  feature_slug: string
  verdict: string
  test_command: string
  lint_command: string
  file_ownership: FileOwnership[]
  interface_contracts: InterfaceContract[]
  waves: Wave[]
  quality_gates?: QualityGates
  scaffolds?: ScaffoldFile[]
  completion_reports?: Record<string, CompletionReport>
  pre_mortem?: PreMortem
  known_issues?: KnownIssue[]
}

export interface FileOwnership {
  file: string
  agent: string
  wave: number
  action?: string
  depends_on?: string[]
  repo?: string
}

export interface Wave {
  number: number
  agents: Agent[]
}

export interface Agent {
  id: string
  task: string
  files: string[]
  dependencies?: string[]
  model?: string
}

export interface CompletionReport {
  status: string
  worktree?: string
  branch?: string
  commit?: string
  files_changed?: string[]
  files_created?: string[]
  interface_deviations?: InterfaceDeviation[]
  out_of_scope_deps?: string[]
  tests_added?: string[]
  verification?: string
  failure_type?: string
  repo?: string
}

export interface InterfaceDeviation {
  description: string
  downstream_action_required: boolean
  affects?: string[]
}

export interface InterfaceContract {
  name: string
  description?: string
  definition: string
  location: string
}

export interface QualityGates {
  level: string
  gates: QualityGate[]
}

export interface QualityGate {
  type: string
  command: string
  required: boolean
  description?: string
}

export interface ScaffoldFile {
  file_path: string
  contents?: string
  import_path?: string
  status?: string
  commit?: string
}

export interface PreMortem {
  overall_risk: string
  rows: PreMortemRow[]
}

export interface PreMortemRow {
  scenario: string
  likelihood: string
  impact: string
  mitigation: string
}

export interface KnownIssue {
  description: string
  status?: string
  workaround?: string
}

export interface ValidationError {
  code: string
  message: string
  field?: string
  line?: number
}

import { sawClient } from './apiClient'

// API functions
export async function loadManifest(slug: string): Promise<IMPLManifest> {
  return await sawClient.impl.manifest(slug) as IMPLManifest
}

export async function validateManifest(slug: string): Promise<{ valid: boolean; errors: ValidationError[] }> {
  return await sawClient.impl.validateManifest(slug) as { valid: boolean; errors: ValidationError[] }
}
