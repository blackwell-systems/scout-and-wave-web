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
}

// WaveInfo describes one wave in the IMPL doc.
type WaveInfo struct {
	Number       int      `json:"number"`
	Agents       []string `json:"agents"`
	Dependencies []int    `json:"dependencies"`
}

// ScaffoldInfo describes the scaffold section of the IMPL doc.
type ScaffoldInfo struct {
	Required  bool            `json:"required"`
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
	Branch     string `json:"branch"`
	Path       string `json:"path"`
	Status     string `json:"status"` // "merged", "unmerged", "stale"
	HasUnsaved bool   `json:"has_unsaved"`
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

// SAWConfig is the shape of saw.config.json and the GET/POST /api/config body.
type SAWConfig struct {
	Repo    RepoConfig    `json:"repo"`
	Agent   AgentConfig   `json:"agent"`
	Quality QualityConfig `json:"quality"`
	Appear  AppearConfig  `json:"appearance"`
}

type RepoConfig struct {
	Path string `json:"path"`
}

type AgentConfig struct {
	ScoutModel string `json:"scout_model"`
	WaveModel  string `json:"wave_model"`
}

type QualityConfig struct {
	RequireTests   bool `json:"require_tests"`
	RequireLint    bool `json:"require_lint"`
	BlockOnFailure bool `json:"block_on_failure"`
}

type AppearConfig struct {
	Theme string `json:"theme"` // "system", "light", "dark"
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
