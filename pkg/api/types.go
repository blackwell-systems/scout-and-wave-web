package api

import (
	"github.com/blackwell-systems/scout-and-wave-go/pkg/config"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/result"
)

// APIResponse wraps an API handler result using the unified result.Result[T] type.
// Handlers that previously returned ad-hoc success/error structs should return
// result.Result[T] where T is the data payload type defined in this package.
//
// Usage in handlers:
//
//	func handleFoo(...) result.Result[FooData] {
//	    data, err := doFoo()
//	    if err != nil {
//	        return result.NewFailure[FooData]([]result.SAWError{{
//	            Code: "E001", Message: err.Error(), Severity: "fatal",
//	        }})
//	    }
//	    return result.NewSuccess(data)
//	}
type APIResponse[T any] = result.Result[T]

// APIError is an alias for result.SAWError, used in API handler return values.
type APIError = result.SAWError

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

// WiringEntry is the API representation of one wiring declaration from
// the IMPL manifest wiring: block. Included in IMPLDocResponse so the
// ReviewScreen can display the Wiring panel (E35).
type WiringEntry struct {
	Symbol             string `json:"symbol"`
	DefinedIn          string `json:"defined_in"`
	MustBeCalledFrom   string `json:"must_be_called_from"`
	Agent              string `json:"agent"`
	Wave               int    `json:"wave"`
	IntegrationPattern string `json:"integration_pattern,omitempty"`
	// Status is "declared" before finalize-wave runs; "verified" when
	// wiring report shows Valid=true; "gap" when a WiringGap exists for
	// this declaration.
	Status string `json:"status"`
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
	PreMortem              *PreMortemEntry               `json:"pre_mortem,omitempty"`
	Reactions              *protocol.ReactionsConfig     `json:"reactions,omitempty"`
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
	Wiring                 []WiringEntry        `json:"wiring,omitempty"`
	ProgramSlug            string               `json:"program_slug,omitempty"`
	ProgramTitle           string               `json:"program_title,omitempty"`
	ProgramTier            int                  `json:"program_tier,omitempty"`
	ProgramTiersTotal      int                  `json:"program_tiers_total,omitempty"`
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

// RepoEntry is a type alias for config.RepoEntry. All API handlers use the
// unified config.RepoEntry type directly.
type RepoEntry = config.RepoEntry

// SAWConfig is a type alias for config.SAWConfig. All API handlers use the
// unified config.SAWConfig type directly.
type SAWConfig = config.SAWConfig

// AgentConfig is a type alias for config.AgentConfig.
type AgentConfig = config.AgentConfig

// QualityConfig is a type alias for config.QualityConfig.
type QualityConfig = config.QualityConfig

// CodeReviewCfg is a type alias for config.CodeReviewCfg.
type CodeReviewCfg = config.CodeReviewCfg

// AppearConfig is a type alias for config.AppearConfig.
type AppearConfig = config.AppearConfig

// ProvidersConfig is a type alias for config.ProvidersConfig.
type ProvidersConfig = config.ProvidersConfig

// ProviderValidationResponse is the response from POST /api/config/providers/{provider}/validate.
type ProviderValidationResponse struct {
	Valid    bool   `json:"valid"`
	Error    string `json:"error,omitempty"`
	Identity string `json:"identity,omitempty"`
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
