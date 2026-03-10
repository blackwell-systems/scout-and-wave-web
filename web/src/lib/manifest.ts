// TypeScript types matching the Protocol SDK's Go types
export interface IMPLManifest {
  title: string
  feature_slug: string
  verdict: string
  file_ownership: FileOwnership[]
  waves: Wave[]
  interface_contracts: InterfaceContract[]
  quality_gates: QualityGates
  scaffolds: ScaffoldFile[]
}

export interface FileOwnership {
  file: string
  agent: string
  wave: number
  action: string
  repo?: string
  depends_on?: string[]
}

export interface Wave {
  number: number
  agents: Agent[]
}

export interface Agent {
  id: string
  description: string
  task: string
  files: string[]
  dependencies: string[]
  model: string
  completion_report?: CompletionReport
}

export interface CompletionReport {
  status: string
  branch: string
  commit: string
  files_changed: string[]
  files_created: string[]
  test_results: string
  interface_deviations: InterfaceDeviation[]
}

export interface InterfaceDeviation {
  contract: string
  deviation: string
  reason: string
  downstream_action_required: boolean
}

export interface InterfaceContract {
  name: string
  language: string
  code: string
  agents: string[]
}

export interface QualityGates {
  test_command: string
  lint_command: string
  gates: QualityGate[]
}

export interface QualityGate {
  name: string
  command: string
  required: boolean
}

export interface ScaffoldFile {
  file: string
  description: string
  status: string
}

export interface ValidationError {
  code: string
  message: string
  field: string
}

// API functions
export async function loadManifest(slug: string): Promise<IMPLManifest> {
  const res = await fetch(`/api/impl/${slug}/manifest`)
  if (!res.ok) throw new Error(`Failed to load manifest: ${res.statusText}`)
  return res.json()
}

export async function validateManifest(slug: string): Promise<{ valid: boolean; errors: ValidationError[] }> {
  const res = await fetch(`/api/impl/${slug}/validate`, { method: 'POST' })
  if (!res.ok) throw new Error(`Failed to validate manifest: ${res.statusText}`)
  return res.json()
}
