package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/packages/param"
)

const (
	defaultModel     = "claude-sonnet-4-5"
	defaultMaxTokens = 8096
)

// Client wraps the Anthropic Messages API.
type Client struct {
	apiKey    string
	model     string
	maxTokens int
	baseURL   string // optional override for testing
}

// NewClient creates a Client. Uses ANTHROPIC_API_KEY env var if apiKey is empty.
// Default model: "claude-sonnet-4-5". Default maxTokens: 8096.
func NewClient(apiKey string) *Client {
	if apiKey == "" {
		apiKey = os.Getenv("ANTHROPIC_API_KEY")
	}
	return &Client{
		apiKey:    apiKey,
		model:     defaultModel,
		maxTokens: defaultMaxTokens,
	}
}

// WithModel sets the model. Returns c for chaining.
func (c *Client) WithModel(model string) *Client {
	c.model = model
	return c
}

// WithMaxTokens sets max output tokens. Returns c for chaining.
func (c *Client) WithMaxTokens(n int) *Client {
	c.maxTokens = n
	return c
}

// newClientWithBaseURL creates a Client that sends requests to baseURL instead
// of the default Anthropic endpoint. Used in tests to point at mock servers.
func newClientWithBaseURL(apiKey, baseURL string) *Client {
	c := NewClient(apiKey)
	c.baseURL = baseURL
	return c
}

// ToolRunner is the interface for API clients that support tool use loops.
type ToolRunner interface {
	RunWithTools(ctx context.Context, prompt string, tools []Tool, maxTurns int) (string, error)
}

// SendMessage sends a conversation turn to the Anthropic API.
// systemPrompt sets the system role. userMessage is the human turn.
// Returns the full assistant response text (streaming collected internally).
// Returns error on API failure, rate limit, or network error.
func (c *Client) sendOpts() []option.RequestOption {
	opts := []option.RequestOption{option.WithAPIKey(c.apiKey)}
	if c.baseURL != "" {
		opts = append(opts, option.WithBaseURL(c.baseURL))
	}
	return opts
}

func (c *Client) SendMessage(systemPrompt, userMessage string) (string, error) {
	sdkClient := anthropic.NewClient(c.sendOpts()...)

	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(c.model),
		MaxTokens: int64(c.maxTokens),
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(userMessage)),
		},
	}

	if systemPrompt != "" {
		params.System = []anthropic.TextBlockParam{
			{Text: systemPrompt},
		}
	}

	stream := sdkClient.Messages.NewStreaming(context.Background(), params)
	text, err := collectStream(stream)
	if err != nil {
		return "", fmt.Errorf("anthropic API error: %w", err)
	}
	return text, nil
}

// RunWithTools executes a tool use loop against the Anthropic API.
// It sends prompt as the user message, calling tools as requested by the model
// until the model returns end_turn or maxTurns is exceeded.
// maxTurns=0 uses a default of 50.
func (c *Client) RunWithTools(ctx context.Context, prompt string, tools []Tool, maxTurns int) (string, error) {
	if maxTurns <= 0 {
		maxTurns = 50
	}

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
		anthropic.NewUserMessage(anthropic.NewTextBlock(prompt)),
	}

	for turn := 0; turn < maxTurns; turn++ {
		resp, err := sdkClient.Messages.New(ctx, anthropic.MessageNewParams{
			Model:     anthropic.Model(c.model),
			MaxTokens: int64(c.maxTokens),
			Messages:  messages,
			Tools:     toolParams,
		})
		if err != nil {
			return "", fmt.Errorf("anthropic API error (turn %d): %w", turn, err)
		}

		if resp.StopReason == anthropic.StopReasonEndTurn {
			// Extract text from response content.
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

			// Unmarshal the raw JSON input into a map.
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
				result, execErr = tool.Execute(inputMap, "")
				if execErr != nil {
					result = fmt.Sprintf("error: %v", execErr)
					isError = true
				}
			}
			toolResultBlocks = append(toolResultBlocks, anthropic.NewToolResultBlock(tu.ID, result, isError))
		}
		messages = append(messages, anthropic.NewUserMessage(toolResultBlocks...))
	}

	return "", fmt.Errorf("runner: tool use loop exceeded maxTurns (%d)", maxTurns)
}
