package api

// PreMortemRowEntry is one row of the pre-mortem risk table.
type PreMortemRowEntry struct {
	Scenario   string `json:"scenario"`
	Likelihood string `json:"likelihood"`
	Impact     string `json:"impact"`
	Mitigation string `json:"mitigation"`
}

// PreMortemEntry is the pre-mortem section in the IMPL doc response.
type PreMortemEntry struct {
	OverallRisk string              `json:"overall_risk"`
	Rows        []PreMortemRowEntry `json:"rows"`
}

// IMPLDocResponse is the JSON body for GET /api/impl/{slug}.
type IMPLDocResponse struct {
	Slug                   string               `json:"slug"`
	Repo                   string               `json:"repo"`                   // repo name this IMPL belongs to
	RepoPath               string               `json:"repo_path"`              // absolute path to the repo
	DocStatus              string               `json:"doc_status"`             // "active" or "complete"
	CompletedAt            string               `json:"completed_at,omitempty"` // ISO date, present only when COMPLETE
	Suitability            SuitabilityInfo      `json:"suitability"`
	FileOwnership          []FileOwnershipEntry `json:"file_ownership"`
	FileOwnershipCol4Name  string               `json:"file_ownership_col4_name"` // detected 4th column header (e.g. "Action", "Depends On")
	Waves                  []WaveInfo           `json:"waves"`
	Scaffold               ScaffoldInfo         `json:"scaffold"`
	PreMortem              *PreMortemEntry      `json:"pre_mortem,omitempty"`
	KnownIssues            []KnownIssueEntry    `json:"known_issues"`
	ScaffoldsDetail        []ScaffoldFileEntry  `json:"scaffolds_detail"`
	InterfaceContractsText string               `json:"interface_contracts_text"`
	DependencyGraphText    string               `json:"dependency_graph_text"`
	PostMergeChecklistText string               `json:"post_merge_checklist_text"`
	StubReportText         string               `json:"stub_report_text"`
	AgentPrompts           []AgentPromptEntry   `json:"agent_prompts"`
	QualityGates           *QualityGates        `json:"quality_gates,omitempty"`
	PostMergeChecklist     *PostMergeChecklist  `json:"post_merge_checklist,omitempty"`
	KnownIssuesStructured  []KnownIssue         `json:"known_issues_structured,omitempty"`
}

// SuitabilityInfo is the suitability sub-object in IMPLDocResponse.
type SuitabilityInfo struct {
	Verdict   string `json:"verdict"`
	Rationale string `json:"rationale"`
}

// FileOwnershipEntry is one row of the file ownership table.
type FileOwnershipEntry struct {
	File      string `json:"file"`
	Agent     string `json:"agent"`
	Wave      int    `json:"wave"`
	Action    string `json:"action"`     // "new", "modify", "delete", or ""
	DependsOn string `json:"depends_on"` // populated when 4th column is "Depends On"
	Repo      string `json:"repo,omitempty"` // 5th column for cross-repo waves (e.g. "scout-and-wave-web")
}

// WaveInfo describes one wave in the IMPL doc.
type WaveInfo struct {
	Number       int      `json:"number"`
	Agents       []string `json:"agents"`
	Dependencies []int    `json:"dependencies"`
	Status       string   `json:"status"` // "pending" | "complete" | "partial"
}

// ScaffoldInfo describes the scaffold section of the IMPL doc.
type ScaffoldInfo struct {
	Required  bool            `json:"required"`
	Committed bool            `json:"committed"` // true when all scaffold files have status "committed"
	Files     []string        `json:"files"`
	Contracts []ContractEntry `json:"contracts"`
}

// ContractEntry is one interface contract in the scaffold.
type ContractEntry struct {
	Name      string `json:"name"`
	Signature string `json:"signature"`
	File      string `json:"file"`
}

// KnownIssueEntry is one known issue from the IMPL doc.
type KnownIssueEntry struct {
	Description string `json:"description"`
	Status      string `json:"status"`
	Workaround  string `json:"workaround"`
}

// QualityGates represents the structured quality gates section from the IMPL manifest.
type QualityGates struct {
	Level string        `json:"level"`
	Gates []QualityGate `json:"gates"`
}

// QualityGate represents a single quality check.
// Type is one of: "build", "lint", "test", "typecheck", "format", "custom"
type QualityGate struct {
	Type        string `json:"type"`
	Command     string `json:"command"`
	Required    bool   `json:"required"`
	Description string `json:"description,omitempty"`
	Fix         bool   `json:"fix,omitempty"` // fix mode: auto-apply formatting (format gates only)
}

// PostMergeChecklist represents the structured post-merge verification checklist.
type PostMergeChecklist struct {
	Groups []ChecklistGroup `json:"groups"`
}

// ChecklistGroup is a logical grouping of related checklist items.
type ChecklistGroup struct {
	Title string          `json:"title"`
	Items []ChecklistItem `json:"items"`
}

// ChecklistItem is a single verification step in the post-merge checklist.
type ChecklistItem struct {
	Description string `json:"description"`
	Command     string `json:"command,omitempty"`
}

// KnownIssue represents a known issue with optional title field.
type KnownIssue struct {
	Title       string `json:"title,omitempty"`
	Description string `json:"description"`
	Status      string `json:"status,omitempty"`
	Workaround  string `json:"workaround,omitempty"`
}

// ScaffoldFileEntry is one scaffold file with its contents.
type ScaffoldFileEntry struct {
	FilePath   string `json:"file_path"`
	Contents   string `json:"contents"`
	ImportPath string `json:"import_path"`
}

// AgentPromptEntry is one agent prompt extracted from a wave.
type AgentPromptEntry struct {
	Wave   int    `json:"wave"`
	Agent  string `json:"agent"`
	Prompt string `json:"prompt"`
}

// SSEEvent is the canonical shape written to the SSE stream.
// Data is marshaled to JSON and written as the `data:` field.
type SSEEvent struct {
	Event string      `json:"event"` // scaffold_started, agent_started, agent_complete, agent_failed, gate_result, wave_complete, run_complete
	Data  interface{} `json:"data"`
}

// WorktreeEntry describes one SAW-managed git worktree.
type WorktreeEntry struct {
	Branch        string `json:"branch"`
	Path          string `json:"path"`
	Status        string `json:"status"` // "merged", "unmerged", "stale"
	HasUnsaved    bool   `json:"has_unsaved"`
	LastCommitAge string `json:"last_commit_age,omitempty"`
}

// WorktreeBatchDeleteRequest is the JSON body for POST /api/impl/{slug}/worktrees/cleanup.
type WorktreeBatchDeleteRequest struct {
	Branches []string `json:"branches"`
	Force    bool     `json:"force"`
}

// WorktreeBatchDeleteResult describes the outcome of deleting a single branch.
type WorktreeBatchDeleteResult struct {
	Branch  string `json:"branch"`
	Deleted bool   `json:"deleted"`
	Error   string `json:"error,omitempty"`
}

// WorktreeBatchDeleteResponse is the JSON body returned by batch-delete.
type WorktreeBatchDeleteResponse struct {
	Results      []WorktreeBatchDeleteResult `json:"results"`
	DeletedCount int                         `json:"deleted_count"`
	FailedCount  int                         `json:"failed_count"`
}

// WorktreeListResponse is the JSON body for GET /api/impl/{slug}/worktrees.
type WorktreeListResponse struct {
	Worktrees []WorktreeEntry `json:"worktrees"`
}

// FileDiffRequest is the query parameter shape for GET /api/impl/{slug}/diff/{agent}.
type FileDiffRequest struct {
	Wave int    `json:"wave"`
	File string `json:"file"`
}

// FileDiffResponse is the JSON body for GET /api/impl/{slug}/diff/{agent}.
type FileDiffResponse struct {
	Agent  string `json:"agent"`
	File   string `json:"file"`
	Branch string `json:"branch"`
	Diff   string `json:"diff"`
}

// RepoEntry is one named repository in the repo registry.
type RepoEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// RepoConfig is kept for backward-compat JSON deserialization of old configs.
type RepoConfig struct {
	Path string `json:"path"`
}

// SAWConfig is the shape of saw.config.json and the GET/POST /api/config body.
type SAWConfig struct {
	Repos   []RepoEntry   `json:"repos,omitempty"`   // authoritative registry
	Repo    RepoConfig    `json:"repo,omitempty"`     // legacy, read-only for migration
	Agent   AgentConfig   `json:"agent"`
	Quality QualityConfig `json:"quality"`
	Appear  AppearConfig  `json:"appearance"`
}

type AgentConfig struct {
	ScoutModel       string `json:"scout_model"`
	WaveModel        string `json:"wave_model"`
	ChatModel        string `json:"chat_model"`
	ScaffoldModel    string `json:"scaffold_model"`
	IntegrationModel string `json:"integration_model"`
	PlannerModel     string `json:"planner_model"`
}

type QualityConfig struct {
	RequireTests   bool `json:"require_tests"`
	RequireLint    bool `json:"require_lint"`
	BlockOnFailure bool `json:"block_on_failure"`
}

type AppearConfig struct {
	Theme               string   `json:"theme"`                         // "system", "light", "dark"
	ColorTheme          string   `json:"color_theme,omitempty"`         // legacy single default
	ColorThemeDark      string   `json:"color_theme_dark,omitempty"`    // dark mode default
	ColorThemeLight     string   `json:"color_theme_light,omitempty"`   // light mode default
	FavoriteThemesDark  []string `json:"favorite_themes_dark,omitempty"`
	FavoriteThemesLight []string `json:"favorite_themes_light,omitempty"`
}

// ChatRequest is the JSON body for POST /api/impl/{slug}/chat.
type ChatRequest struct {
	Message string        `json:"message"`
	History []ChatMessage `json:"history"`
}

// ChatMessage is one turn in the chat history.
type ChatMessage struct {
	Role    string `json:"role"`    // "user" | "assistant"
	Content string `json:"content"`
}

// ChatRunResponse is the JSON body returned by POST /api/impl/{slug}/chat.
type ChatRunResponse struct {
	RunID string `json:"run_id"`
}

// AgentContextResponse is the JSON body for GET /api/impl/{slug}/agent/{letter}/context.
type AgentContextResponse struct {
	Slug        string `json:"slug"`
	Agent       string `json:"agent"`
	Wave        int    `json:"wave"`
	ContextText string `json:"context_text"`
}

// AgentToolCallPayload is the SSE event data for "agent_tool_call" events.
// Emitted once per tool invocation (is_result=false) and once per tool
// result (is_result=true) for each wave agent.
type AgentToolCallPayload struct {
	Agent      string `json:"agent"`
	Wave       int    `json:"wave"`
	ToolID     string `json:"tool_id"`
	ToolName   string `json:"tool_name"`
	Input      string `json:"input"`
	IsResult   bool   `json:"is_result"`
	IsError    bool   `json:"is_error"`
	DurationMs int64  `json:"duration_ms"`
}

// AgentProgressPayload is the Data payload for the "agent_progress" SSE event.
type AgentProgressPayload struct {
	Agent         string `json:"agent"`
	Wave          int    `json:"wave"`
	CurrentFile   string `json:"current_file"`
	CurrentAction string `json:"current_action"`
	PercentDone   int    `json:"percent_done"`
}

// WaveStatusResponse is the JSON body for GET /api/wave/{slug}/status.
type WaveStatusResponse struct {
	Slug   string           `json:"slug"`
	Agents []*AgentProgress `json:"agents"`
}
