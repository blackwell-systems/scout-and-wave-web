package api

// TEMP: These types are owned by Agent A (pkg/api/types.go additions).
// This file exists only to allow wave1-agent-C's worktree to build in isolation.
// Remove after Wave 1 merge — Agent A's types.go additions replace these.

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

// RepoConfig holds repo-level settings.
type RepoConfig struct {
	Path string `json:"path"`
}

// AgentConfig holds agent model settings.
type AgentConfig struct {
	ScoutModel string `json:"scout_model"`
	WaveModel  string `json:"wave_model"`
}

// QualityConfig holds quality gate settings.
type QualityConfig struct {
	RequireTests   bool `json:"require_tests"`
	RequireLint    bool `json:"require_lint"`
	BlockOnFailure bool `json:"block_on_failure"`
}

// AppearConfig holds appearance settings.
type AppearConfig struct {
	Theme string `json:"theme"` // "system", "light", "dark"
}

// AgentContextResponse is the JSON body for GET /api/impl/{slug}/agent/{letter}/context.
type AgentContextResponse struct {
	Slug        string `json:"slug"`
	Agent       string `json:"agent"`
	Wave        int    `json:"wave"`
	ContextText string `json:"context_text"`
}

// ChatRequest is the JSON body for POST /api/impl/{slug}/chat.
type ChatRequest struct {
	Message string        `json:"message"`
	History []ChatMessage `json:"history"`
}

// ChatMessage is one turn in the chat history.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatRunResponse is the JSON body returned by POST /api/impl/{slug}/chat.
type ChatRunResponse struct {
	RunID string `json:"run_id"`
}
