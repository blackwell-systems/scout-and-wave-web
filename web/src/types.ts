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
  status: 'pending' | 'complete' | 'partial'
}

export interface ContractEntry {
  name: string
  signature: string
  file: string
}

export interface ScaffoldInfo {
  required: boolean
  committed: boolean // true when all scaffold files have status "committed"
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

export interface ReactionEntry {
  action: 'retry' | 'send-fix-prompt' | 'pause' | 'auto-scout'
  max_attempts?: number
}

export interface ReactionsConfig {
  transient?:    ReactionEntry
  timeout?:      ReactionEntry
  fixable?:      ReactionEntry
  needs_replan?: ReactionEntry
  escalate?:     ReactionEntry
}

export interface AgentPromptEntry {
  wave: number
  agent: string
  prompt: string
}

export interface WiringEntry {
  symbol: string
  defined_in: string
  must_be_called_from: string
  agent: string
  wave: number
  integration_pattern?: string
  status: 'declared' | 'verified' | 'gap'
}

export interface IMPLDocResponse {
  slug: string
  repo: string // repo name this IMPL belongs to
  repo_path: string // absolute path to the repo
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
  reactions?: ReactionsConfig
  wiring?: WiringEntry[]
}

export interface IMPLListEntry {
  slug: string
  repo: string // repo name this IMPL belongs to
  repo_path: string // absolute path to the repo
  doc_status: string // "active" or "complete" (lowercase)
  wave_count?: number
  agent_count?: number
  is_multi_repo?: boolean
  involved_repos?: string[] // list of repo names from file ownership (for multirepo IMPLs)
  is_executing?: boolean    // true when wave/scout/merge/test is in progress
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
  notes?: string
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
  notes?: string
  message?: string
  output?: string
  startedAt?: number  // ms timestamp when agent_started fired
  toolCalls?: ToolCallEntry[]
  taskSummary?: string  // first line/heading of the agent task field, populated by Go API
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
  last_commit_age?: string  // e.g. "3 hours ago"
}

export interface WorktreeBatchDeleteRequest {
  branches: string[]
  force: boolean
}

export interface WorktreeBatchDeleteResult {
  branch: string
  deleted: boolean
  error: string
}

export interface WorktreeBatchDeleteResponse {
  results: WorktreeBatchDeleteResult[]
  deleted_count: number
  failed_count: number
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
  agent: { scout_model: string; wave_model: string; chat_model?: string; scaffold_model?: string; integration_model?: string; planner_model?: string; review_model?: string }
  quality: {
    require_tests: boolean
    require_lint: boolean
    block_on_failure: boolean
    code_review?: {
      enabled: boolean
      blocking: boolean
      model: string
      threshold: number
    }
  }
  appearance: { theme: 'system' | 'light' | 'dark'; color_theme?: string; color_theme_dark?: string; color_theme_light?: string; favorite_themes_dark?: string[]; favorite_themes_light?: string[] }
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

// Post-merge checklist display
export interface PostMergeChecklist {
  groups: ChecklistGroup[]
}

export interface ChecklistGroup {
  title: string
  items: ChecklistItem[]
}

export interface ChecklistItem {
  description: string
  command?: string
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

// Interrupted session detection (resume)

export interface DirtyWorktree {
  path: string
  branch: string
  agent_id: string
  wave_num: number
  has_changes: boolean
}

export interface AgentSessionInfo {
  agent_id: string
  session_id: string
  wave_num: number
  worktree_path: string
  last_active: string
}

export interface InterruptedSession {
  impl_slug: string
  impl_path: string
  current_wave: number
  total_waves: number
  completed_agents: string[]
  failed_agents: string[]
  pending_agents: string[]
  orphaned_worktrees: string[]
  suggested_action: string
  progress_pct: number
  can_auto_resume: boolean
  resume_command: string
  dirty_worktrees?: DirtyWorktree[]
  agent_sessions?: Record<string, AgentSessionInfo>
}

// Conflict resolution SSE events (v0.20.0-D)
// - conflict_resolving:        {slug, wave, file}
// - conflict_resolved:         {slug, wave, file}
// - conflict_resolution_failed: {slug, wave, file, error}

// E37: Critic Agent review result types
export interface CriticResult {
  verdict: 'PASS' | 'ISSUES';
  agent_reviews: Record<string, AgentCriticReview>;
  summary: string;
  reviewed_at: string;
  issue_count: number;
}

export interface AgentCriticReview {
  agent_id: string;
  verdict: 'PASS' | 'ISSUES';
  issues?: CriticIssue[];
}

export interface CriticIssue {
  check: string;
  severity: 'error' | 'warning';
  description: string;
  file?: string;
  symbol?: string;
}
