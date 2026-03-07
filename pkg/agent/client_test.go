package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNewClient_FromEnv(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "test-key-from-env")
	c := NewClient("")
	if c.apiKey != "test-key-from-env" {
		t.Errorf("expected apiKey from env, got %q", c.apiKey)
	}
}

func TestNewClient_ExplicitKey(t *testing.T) {
	c := NewClient("explicit-key-12345")
	if c.apiKey != "explicit-key-12345" {
		t.Errorf("expected explicit apiKey, got %q", c.apiKey)
	}
}

func TestNewClient_Defaults(t *testing.T) {
	c := NewClient("some-key")
	if c.model != defaultModel {
		t.Errorf("expected default model %q, got %q", defaultModel, c.model)
	}
	if c.maxTokens != defaultMaxTokens {
		t.Errorf("expected default maxTokens %d, got %d", defaultMaxTokens, c.maxTokens)
	}
}

func TestWithModel(t *testing.T) {
	c := NewClient("key").WithModel("claude-opus-4-5")
	if c.model != "claude-opus-4-5" {
		t.Errorf("expected model %q, got %q", "claude-opus-4-5", c.model)
	}
}

func TestWithMaxTokens(t *testing.T) {
	c := NewClient("key").WithMaxTokens(4096)
	if c.maxTokens != 4096 {
		t.Errorf("expected maxTokens 4096, got %d", c.maxTokens)
	}
}

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

// TestRunWithTools_EndTurn verifies that RunWithTools returns immediately when
// the server responds with stop_reason=end_turn on the first call.
func TestRunWithTools_EndTurn(t *testing.T) {
	t.Parallel()

	want := "task complete"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write(anthropicEndTurnResponse(want))
	}))
	defer srv.Close()

	c := newClientWithBaseURL("test-key", srv.URL)
	tools := []Tool{
		{
			Name:        "noop",
			Description: "does nothing",
			InputSchema: map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
			Execute: func(_ map[string]interface{}, _ string) (string, error) {
				return "noop result", nil
			},
		},
	}

	result, err := c.RunWithTools(context.Background(), "do something", tools, 5)
	if err != nil {
		t.Fatalf("RunWithTools returned error: %v", err)
	}
	if !strings.Contains(result, want) {
		t.Errorf("result = %q; want it to contain %q", result, want)
	}
}

// TestRunWithTools_MaxTurnsExceeded verifies that RunWithTools returns an error
// when the model keeps requesting tool_use beyond maxTurns.
func TestRunWithTools_MaxTurnsExceeded(t *testing.T) {
	t.Parallel()

	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		// Always return tool_use to force the loop to exhaust maxTurns.
		w.Write(anthropicToolUseResponse("tool-id-1", "noop", map[string]interface{}{}))
	}))
	defer srv.Close()

	c := newClientWithBaseURL("test-key", srv.URL)
	tools := []Tool{
		{
			Name:        "noop",
			Description: "does nothing",
			InputSchema: map[string]interface{}{"type": "object", "properties": map[string]interface{}{}},
			Execute: func(_ map[string]interface{}, _ string) (string, error) {
				return "noop result", nil
			},
		},
	}

	maxTurns := 3
	_, err := c.RunWithTools(context.Background(), "loop forever", tools, maxTurns)
	if err == nil {
		t.Fatal("RunWithTools should have returned an error when maxTurns exceeded")
	}
	if !strings.Contains(err.Error(), "maxTurns") {
		t.Errorf("error = %q; want it to mention maxTurns", err.Error())
	}
	if callCount != maxTurns {
		t.Errorf("server called %d times; want %d", callCount, maxTurns)
	}
}
