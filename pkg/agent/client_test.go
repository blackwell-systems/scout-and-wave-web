package agent

import (
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
