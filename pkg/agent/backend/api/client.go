// Package api provides an Anthropic API backend that implements the backend.Backend
// interface. It runs a full tool-use loop against the Anthropic Messages API,
// using the standard SAW tools (read_file, write_file, list_directory, bash).
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/packages/param"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend"
)

const (
	defaultModel     = "claude-sonnet-4-5"
	defaultMaxTokens = 8096
	defaultMaxTurns  = 50
)

// Client is an Anthropic API backend. It implements backend.Backend.
type Client struct {
	apiKey    string
	model     string
	maxTokens int
	maxTurns  int
	baseURL   string // optional override for testing
}

// New creates a new Client configured from cfg.
// If apiKey is empty, the ANTHROPIC_API_KEY environment variable is used.
// cfg.Model defaults to "claude-sonnet-4-5" if empty.
// cfg.MaxTokens defaults to 8096 if zero.
// cfg.MaxTurns defaults to 50 if zero.
func New(apiKey string, cfg backend.Config) *Client {
	if apiKey == "" {
		apiKey = os.Getenv("ANTHROPIC_API_KEY")
	}
	model := cfg.Model
	if model == "" {
		model = defaultModel
	}
	maxTokens := cfg.MaxTokens
	if maxTokens <= 0 {
		maxTokens = defaultMaxTokens
	}
	maxTurns := cfg.MaxTurns
	if maxTurns <= 0 {
		maxTurns = defaultMaxTurns
	}
	return &Client{
		apiKey:    apiKey,
		model:     model,
		maxTokens: maxTokens,
		maxTurns:  maxTurns,
	}
}

// WithBaseURL overrides the Anthropic API endpoint. Used in tests to point at
// a mock HTTP server. Returns c for chaining.
func (c *Client) WithBaseURL(url string) *Client {
	c.baseURL = url
	return c
}

func (c *Client) sendOpts() []option.RequestOption {
	opts := []option.RequestOption{option.WithAPIKey(c.apiKey)}
	if c.baseURL != "" {
		opts = append(opts, option.WithBaseURL(c.baseURL))
	}
	return opts
}

// Run executes the agent described by systemPrompt and userMessage.
// It runs a tool-use loop using StandardTools scoped to workDir until the model
// signals end_turn or maxTurns is exceeded.
// Run implements backend.Backend.
func (c *Client) Run(ctx context.Context, systemPrompt, userMessage, workDir string) (string, error) {
	tools := StandardTools(workDir)

	sdkClient := anthropic.NewClient(c.sendOpts()...)

	// Build tool params for the API.
	toolParams := make([]anthropic.ToolUnionParam, 0, len(tools))
	for _, t := range tools {
		schema := anthropic.ToolInputSchemaParam{
			Properties: t.InputSchema["properties"],
		}
		if req, ok := t.InputSchema["required"]; ok {
			if reqSlice, ok := req.([]string); ok {
				schema.Required = reqSlice
			}
		}
		tp := anthropic.ToolUnionParamOfTool(schema, t.Name)
		if tp.OfTool != nil && t.Description != "" {
			tp.OfTool.Description = param.NewOpt(t.Description)
		}
		toolParams = append(toolParams, tp)
	}

	// Build tool lookup map.
	toolMap := make(map[string]Tool, len(tools))
	for _, t := range tools {
		toolMap[t.Name] = t
	}

	messages := []anthropic.MessageParam{
		anthropic.NewUserMessage(anthropic.NewTextBlock(userMessage)),
	}

	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(c.model),
		MaxTokens: int64(c.maxTokens),
		Tools:     toolParams,
	}
	if systemPrompt != "" {
		params.System = []anthropic.TextBlockParam{
			{Text: systemPrompt},
		}
	}

	for turn := 0; turn < c.maxTurns; turn++ {
		params.Messages = messages

		resp, err := sdkClient.Messages.New(ctx, params)
		if err != nil {
			return "", fmt.Errorf("anthropic API error (turn %d): %w", turn, err)
		}

		if resp.StopReason == anthropic.StopReasonEndTurn {
			var sb strings.Builder
			for _, block := range resp.Content {
				if block.Type == "text" {
					sb.WriteString(block.AsText().Text)
				}
			}
			return sb.String(), nil
		}

		if resp.StopReason != anthropic.StopReasonToolUse {
			return "", fmt.Errorf("unexpected stop reason: %s", resp.StopReason)
		}

		// Append the assistant message with full content.
		assistantBlocks := make([]anthropic.ContentBlockParamUnion, 0, len(resp.Content))
		for _, block := range resp.Content {
			switch block.Type {
			case "text":
				tb := block.AsText()
				assistantBlocks = append(assistantBlocks, anthropic.NewTextBlock(tb.Text))
			case "tool_use":
				tu := block.AsToolUse()
				assistantBlocks = append(assistantBlocks, anthropic.NewToolUseBlock(tu.ID, tu.Input, tu.Name))
			}
		}
		messages = append(messages, anthropic.NewAssistantMessage(assistantBlocks...))

		// Execute each tool_use block and collect results.
		toolResultBlocks := make([]anthropic.ContentBlockParamUnion, 0)
		for _, block := range resp.Content {
			if block.Type != "tool_use" {
				continue
			}
			tu := block.AsToolUse()

			var inputMap map[string]interface{}
			if err := json.Unmarshal(tu.Input, &inputMap); err != nil {
				inputMap = map[string]interface{}{}
			}

			tool, found := toolMap[tu.Name]
			var result string
			var isError bool
			if !found {
				result = fmt.Sprintf("error: unknown tool %q", tu.Name)
				isError = true
			} else {
				var execErr error
				result, execErr = tool.Execute(inputMap, workDir)
				if execErr != nil {
					result = fmt.Sprintf("error: %v", execErr)
					isError = true
				}
			}
			toolResultBlocks = append(toolResultBlocks, anthropic.NewToolResultBlock(tu.ID, result, isError))
		}
		messages = append(messages, anthropic.NewUserMessage(toolResultBlocks...))
	}

	return "", fmt.Errorf("api: tool use loop exceeded maxTurns (%d)", c.maxTurns)
}
