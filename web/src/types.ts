// Mirrored from pkg/api/types.go

export interface SuitabilityInfo {
  verdict: string
  rationale: string
}

export interface FileOwnershipEntry {
  file: string
  agent: string
  wave: number
  action: string // "new", "modify", "delete", or ""
  depends_on: string // populated when 4th column is "Depends On"
}

export interface WaveInfo {
  number: number
  agents: string[]
  dependencies: number[]
}

export interface ContractEntry {
  name: string
  signature: string
  file: string
}

export interface ScaffoldInfo {
  required: boolean
  files: string[]
  contracts: ContractEntry[]
}

export interface KnownIssueEntry {
  description: string
  status: string
  workaround: string
}

export interface ScaffoldFileEntry {
  file_path: string
  contents: string
  import_path: string
}

export interface PreMortemRow {
  scenario: string
  likelihood: string
  impact: string
  mitigation: string
}

export interface PreMortem {
  overall_risk: string  // "low", "medium", or "high"
  rows: PreMortemRow[]
}

export interface AgentPromptEntry {
  wave: number
  agent: string
  prompt: string
}

export interface IMPLDocResponse {
  slug: string
  doc_status: string // "active" or "complete" (lowercase)
  completed_at?: string // ISO date, present only when complete
  suitability: SuitabilityInfo
  file_ownership: FileOwnershipEntry[]
  file_ownership_col4_name: string // detected 4th column header (e.g. "Action", "Depends On")
  waves: WaveInfo[]
  scaffold: ScaffoldInfo
  known_issues: KnownIssueEntry[]
  scaffolds_detail: ScaffoldFileEntry[]
  interface_contracts_text: string
  dependency_graph_text: string
  post_merge_checklist_text: string
  agent_prompts: AgentPromptEntry[]
  pre_mortem?: PreMortem
}

export interface IMPLListEntry {
  slug: string
  doc_status: string // "active" or "complete" (lowercase)
}

// SSE event data shapes

export interface ScaffoldStartedData {
  files: string[]
}

export interface ScaffoldCompleteData {
  status: string
}

export interface AgentStartedData {
  agent: string
  wave: number
  files: string[]
}

export interface AgentCompleteData {
  agent: string
  wave: number
  status: string
  branch: string
}

export interface AgentFailedData {
  agent: string
  wave: number
  status: string
  failure_type: string
  message: string
}

export interface GateResultData {
  gate: string
  passed: boolean
  duration_seconds: number
}

export interface WaveCompleteData {
  wave: number
  merge_status: string
}

export interface RunCompleteData {
  status: string
  waves: number
  agents: number
}

// Agent status for WaveBoard

export type AgentStatusValue = 'pending' | 'running' | 'complete' | 'failed'

export interface AgentOutputData {
  agent: string
  wave: number
  chunk: string
}

export interface AgentStatus {
  agent: string
  wave: number
  files: string[]
  status: AgentStatusValue
  branch?: string
  failure_type?: string
  message?: string
  output?: string   // NEW: accumulated streaming output chunks
}

export interface WaveState {
  wave: number
  agents: AgentStatus[]
  merge_status?: string
  complete: boolean
}
