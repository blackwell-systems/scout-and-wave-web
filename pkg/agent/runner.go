// Package agent provides the runner that orchestrates agent execution in
// worktree contexts and utilities for parsing completion reports.
package agent

import (
	"context"
	"fmt"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/worktree"
)

// Sender is the interface Runner uses to call the LLM API.
// It is implemented by *Client (from client.go, owned by Agent D).
// Using an interface here allows Runner to compile and be tested independently
// of Agent D's parallel implementation of client.go.
type Sender interface {
	SendMessage(systemPrompt, userMessage string) (string, error)
}

// Runner orchestrates agent execution in worktree contexts.
type Runner struct {
	client     Sender
	toolRunner ToolRunner
	worktrees  *worktree.Manager
}

// NewRunner creates a Runner backed by the given Sender and worktree Manager.
// If client also implements ToolRunner, tool use is enabled automatically.
func NewRunner(client Sender, worktrees *worktree.Manager) *Runner {
	r := &Runner{
		client:    client,
		worktrees: worktrees,
	}
	if tr, ok := client.(ToolRunner); ok {
		r.toolRunner = tr
	}
	return r
}

// Execute sends agentSpec.Prompt to the LLM API as the system prompt, paired
// with a user message that provides the worktreePath for context. It returns
// the raw API response text. API errors are returned immediately without retry.
func (r *Runner) Execute(agentSpec *types.AgentSpec, worktreePath string) (string, error) {
	systemPrompt := agentSpec.Prompt

	userMessage := fmt.Sprintf(
		"You are operating in worktree: %s\n"+
			"Navigate there first (cd %s) before any file operations.\n\n"+
			"Your task is defined in Field 0 of your prompt above. Begin now.",
		worktreePath,
		worktreePath,
	)

	response, err := r.client.SendMessage(systemPrompt, userMessage)
	if err != nil {
		return "", fmt.Errorf("runner: Execute agent %s: %w", agentSpec.Letter, err)
	}

	return response, nil
}

// ExecuteWithTools runs agentSpec.Prompt through a tool use loop, giving the
// agent access to the provided tools. workDir scopes all file operations.
// maxTurns=0 uses the client default (50).
func (r *Runner) ExecuteWithTools(ctx context.Context, agentSpec *types.AgentSpec, workDir string, tools []Tool, maxTurns int) (string, error) {
	if r.toolRunner == nil {
		return "", fmt.Errorf("runner: client does not support tool use")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return r.toolRunner.RunWithTools(ctx, agentSpec.Prompt, tools, maxTurns)
}

// ParseCompletionReport reads the IMPL doc at implDocPath and extracts the
// completion report for agentLetter. It delegates to protocol.ParseCompletionReport.
// Returns protocol.ErrReportNotFound if the section does not exist yet.
func (r *Runner) ParseCompletionReport(implDocPath string, agentLetter string) (*types.CompletionReport, error) {
	return protocol.ParseCompletionReport(implDocPath, agentLetter)
}
