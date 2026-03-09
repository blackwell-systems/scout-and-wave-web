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
  repo?: string // 5th column for cross-repo waves (e.g. "scout-and-wave-web")
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
  stub_report_text: string
  agent_prompts: AgentPromptEntry[]
  pre_mortem?: PreMortem
}

export interface IMPLListEntry {
  slug: string
  doc_status: string // "active" or "complete" (lowercase)
  wave_count?: number
  agent_count?: number
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
  output?: string
  startedAt?: number  // ms timestamp when agent_started fired
  toolCalls?: ToolCallEntry[]
}

export interface WaveState {
  wave: number
  agents: AgentStatus[]
  merge_status?: string
  complete: boolean
}

// Worktree manager (v0.17.0-D)
export interface WorktreeEntry {
  branch: string
  path: string
  status: 'merged' | 'unmerged' | 'stale'
  has_unsaved: boolean
}

export interface WorktreeListResponse {
  worktrees: WorktreeEntry[]
}

// File diff viewer (v0.17.0-C)
export interface FileDiffResponse {
  agent: string
  file: string
  branch: string
  diff: string
}

// Settings (v0.18.0-C)

/** One registered repository in the SAWConfig repo registry. */
export interface RepoEntry {
  name: string   // human-readable label, e.g. "web", "go"
  path: string   // absolute filesystem path
}

/** Updated SAWConfig — repos replaces the old repo.path singleton. */
export interface SAWConfig {
  repos: RepoEntry[]                             // NEW: named repo registry
  repo: { path: string }                         // KEPT for backward compat read
  agent: { scout_model: string; wave_model: string; chat_model?: string }
  quality: { require_tests: boolean; require_lint: boolean; block_on_failure: boolean }
  appearance: { theme: 'system' | 'light' | 'dark' }
}

// Chat with Claude (v0.18.0-B)
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// Quality gates display
export interface QualityGate {
  command: string
  required: boolean
  description: string
}

// Scout context (v0.18.0-A)
export interface ScoutContext {
  files: string[]
  notes: string
  constraints: string[]
}

// Per-agent context payload (v0.18.0-K)
export interface AgentContextResponse {
  slug: string
  agent: string
  wave: number
  context_text: string
}

// Agent tool call data (Agent Observatory v0.19.0-E)
export interface AgentToolCallData {
  agent: string
  wave: number
  tool_id: string
  tool_name: string
  input: string
  is_result: boolean
  is_error: boolean
  duration_ms: number
}

export interface ToolCallEntry {
  tool_id: string
  tool_name: string
  input: string
  started_at: number     // Date.now() when tool_use arrived
  duration_ms?: number   // populated when tool_result arrives
  is_error?: boolean
  status: 'running' | 'done' | 'error'
}
