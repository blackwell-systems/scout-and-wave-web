package agent

import (
	"context"
	"fmt"
	"os"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
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

// SendMessage sends a conversation turn to the Anthropic API.
// systemPrompt sets the system role. userMessage is the human turn.
// Returns the full assistant response text (streaming collected internally).
// Returns error on API failure, rate limit, or network error.
func (c *Client) SendMessage(systemPrompt, userMessage string) (string, error) {
	sdkClient := anthropic.NewClient(option.WithAPIKey(c.apiKey))

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
