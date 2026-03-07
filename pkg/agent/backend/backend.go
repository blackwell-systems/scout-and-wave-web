package backend

import "context"

// Config carries backend-agnostic configuration.
type Config struct {
	// Model is the Claude model identifier (e.g. "claude-sonnet-4-5").
	// Ignored by the CLI backend (model is configured in Claude Code settings).
	Model string

	// MaxTokens caps output token count. Ignored by the CLI backend.
	MaxTokens int

	// MaxTurns is the tool-use loop limit. 0 means use the backend default (50).
	MaxTurns int
}

// Backend is the abstraction both the API client and the CLI client implement.
// Runner accepts a Backend and delegates all LLM interaction through it.
type Backend interface {
	// Run executes the agent described by systemPrompt and userMessage,
	// using workDir as the working directory for any file/shell operations.
	// It returns the final assistant text when the agent signals completion.
	Run(ctx context.Context, systemPrompt, userMessage, workDir string) (string, error)
}
