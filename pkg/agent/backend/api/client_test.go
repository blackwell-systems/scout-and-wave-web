package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend"
)

// anthropicEndTurnResponse builds a minimal Anthropic Messages API JSON response
// with stop_reason=end_turn and a single text content block.
func anthropicEndTurnResponse(text string) []byte {
	resp := map[string]interface{}{
		"id":   "msg_test",
		"type": "message",
		"role": "assistant",
		"content": []map[string]interface{}{
			{"type": "text", "text": text},
		},
		"model":         "claude-sonnet-4-5",
		"stop_reason":   "end_turn",
		"stop_sequence": nil,
		"usage":         map[string]int{"input_tokens": 10, "output_tokens": 5},
	}
	b, _ := json.Marshal(resp)
	return b
}

// anthropicToolUseResponse builds a minimal Anthropic Messages API JSON response
// with stop_reason=tool_use and a single tool_use content block.
func anthropicToolUseResponse(toolID, toolName string, input map[string]interface{}) []byte {
	inputJSON, _ := json.Marshal(input)
	resp := map[string]interface{}{
		"id":   "msg_test",
		"type": "message",
		"role": "assistant",
		"content": []map[string]interface{}{
			{
				"type":  "tool_use",
				"id":    toolID,
				"name":  toolName,
				"input": json.RawMessage(inputJSON),
			},
		},
		"model":         "claude-sonnet-4-5",
		"stop_reason":   "tool_use",
		"stop_sequence": nil,
		"usage":         map[string]int{"input_tokens": 10, "output_tokens": 5},
	}
	b, _ := json.Marshal(resp)
	return b
}

// TestNew_EmptyAPIKeyFallsBackToEnv verifies that New uses ANTHROPIC_API_KEY
// when apiKey argument is empty.
func TestNew_EmptyAPIKeyFallsBackToEnv(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "env-key-12345")
	c := New("", backend.Config{})
	if c.apiKey != "env-key-12345" {
		t.Errorf("expected apiKey from env, got %q", c.apiKey)
	}
}

// TestNew_ExplicitKeyTakesPrecedence verifies that an explicit apiKey is used
// over the environment variable.
func TestNew_ExplicitKeyTakesPrecedence(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "env-key")
	c := New("explicit-key", backend.Config{})
	if c.apiKey != "explicit-key" {
		t.Errorf("expected explicit apiKey, got %q", c.apiKey)
	}
}

// TestNew_Defaults verifies that Config zero values produce sensible defaults.
func TestNew_Defaults(t *testing.T) {
	c := New("key", backend.Config{})
	if c.model != defaultModel {
		t.Errorf("expected default model %q, got %q", defaultModel, c.model)
	}
	if c.maxTokens != defaultMaxTokens {
		t.Errorf("expected default maxTokens %d, got %d", defaultMaxTokens, c.maxTokens)
	}
	if c.maxTurns != defaultMaxTurns {
		t.Errorf("expected default maxTurns %d, got %d", defaultMaxTurns, c.maxTurns)
	}
}

// TestNew_ConfigValues verifies that non-zero Config values are applied.
func TestNew_ConfigValues(t *testing.T) {
	cfg := backend.Config{
		Model:     "claude-opus-4-5",
		MaxTokens: 4096,
		MaxTurns:  10,
	}
	c := New("key", cfg)
	if c.model != "claude-opus-4-5" {
		t.Errorf("expected model %q, got %q", "claude-opus-4-5", c.model)
	}
	if c.maxTokens != 4096 {
		t.Errorf("expected maxTokens 4096, got %d", c.maxTokens)
	}
	if c.maxTurns != 10 {
		t.Errorf("expected maxTurns 10, got %d", c.maxTurns)
	}
}

// TestWithBaseURL verifies that WithBaseURL stores the override and returns the
// same Client for chaining.
func TestWithBaseURL(t *testing.T) {
	c := New("key", backend.Config{})
	c2 := c.WithBaseURL("http://localhost:9999")
	if c.baseURL != "http://localhost:9999" {
		t.Errorf("expected baseURL to be set, got %q", c.baseURL)
	}
	if c2 != c {
		t.Error("WithBaseURL should return the same *Client for chaining")
	}
}

// TestRun_EndTurn verifies that Run returns the text content when the mock
// server responds with stop_reason=end_turn on the first call.
func TestRun_EndTurn(t *testing.T) {
	t.Parallel()

	want := "task complete"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write(anthropicEndTurnResponse(want))
	}))
	defer srv.Close()

	c := New("test-key", backend.Config{MaxTurns: 5}).WithBaseURL(srv.URL)
	result, err := c.Run(context.Background(), "system prompt", "do something", t.TempDir())
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if !strings.Contains(result, want) {
		t.Errorf("result = %q; want it to contain %q", result, want)
	}
}

// TestRun_ToolUseLoop verifies that Run handles a tool_use response followed by
// an end_turn response, completing the loop successfully.
func TestRun_ToolUseLoop(t *testing.T) {
	t.Parallel()

	callCount := 0
	want := "loop done"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		callCount++
		if callCount == 1 {
			// First call: return a tool_use for list_directory (a real standard tool).
			w.Write(anthropicToolUseResponse("tool-id-1", "list_directory", map[string]interface{}{
				"path": ".",
			}))
		} else {
			// Second call: return end_turn.
			w.Write(anthropicEndTurnResponse(want))
		}
	}))
	defer srv.Close()

	c := New("test-key", backend.Config{MaxTurns: 5}).WithBaseURL(srv.URL)
	result, err := c.Run(context.Background(), "system", "user msg", t.TempDir())
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if !strings.Contains(result, want) {
		t.Errorf("result = %q; want it to contain %q", result, want)
	}
	if callCount != 2 {
		t.Errorf("server called %d times; want 2", callCount)
	}
}

// TestRun_ImplementsBackendInterface verifies at compile time that *Client
// satisfies the backend.Backend interface.
func TestRun_ImplementsBackendInterface(t *testing.T) {
	var _ backend.Backend = (*Client)(nil)
}
