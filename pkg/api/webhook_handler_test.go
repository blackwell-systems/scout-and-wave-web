package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestWebhookHandler_GetAdapters_Empty(t *testing.T) {
	tmpDir := t.TempDir()
	s := &Server{cfg: Config{RepoPath: tmpDir}}

	req := httptest.NewRequest(http.MethodGet, "/api/webhooks", nil)
	w := httptest.NewRecorder()

	s.handleGetWebhookAdapters(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var wc WebhookConfig
	if err := json.NewDecoder(w.Body).Decode(&wc); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if wc.Enabled {
		t.Error("expected enabled=false for empty config")
	}
	if len(wc.Adapters) != 0 {
		t.Errorf("expected 0 adapters, got %d", len(wc.Adapters))
	}
}

func TestWebhookHandler_GetAdapters_WithConfig(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "saw.config.json")

	cfg := map[string]interface{}{
		"webhooks": WebhookConfig{
			Enabled: true,
			Adapters: []WebhookAdapterConfig{
				{Type: "slack", WebhookURL: "https://hooks.slack.com/test", Channel: "#saw"},
			},
		},
	}
	data, _ := json.MarshalIndent(cfg, "", "  ")
	os.WriteFile(configPath, data, 0644)

	s := &Server{cfg: Config{RepoPath: tmpDir}}

	req := httptest.NewRequest(http.MethodGet, "/api/webhooks", nil)
	w := httptest.NewRecorder()

	s.handleGetWebhookAdapters(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var wc WebhookConfig
	if err := json.NewDecoder(w.Body).Decode(&wc); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !wc.Enabled {
		t.Error("expected enabled=true")
	}
	if len(wc.Adapters) != 1 {
		t.Fatalf("expected 1 adapter, got %d", len(wc.Adapters))
	}
	if wc.Adapters[0].Type != "slack" {
		t.Errorf("expected adapter type slack, got %s", wc.Adapters[0].Type)
	}
	if wc.Adapters[0].Channel != "#saw" {
		t.Errorf("expected channel #saw, got %s", wc.Adapters[0].Channel)
	}
}

func TestWebhookHandler_SaveAdapters(t *testing.T) {
	tmpDir := t.TempDir()
	// Create initial config with some other data
	configPath := filepath.Join(tmpDir, "saw.config.json")
	initial := map[string]interface{}{
		"notifications": map[string]interface{}{"enabled": true},
	}
	data, _ := json.MarshalIndent(initial, "", "  ")
	os.WriteFile(configPath, data, 0644)

	s := &Server{cfg: Config{RepoPath: tmpDir}}

	wc := WebhookConfig{
		Enabled: true,
		Adapters: []WebhookAdapterConfig{
			{Type: "discord", WebhookURL: "https://discord.com/api/webhooks/test"},
		},
	}
	body, _ := json.Marshal(wc)

	req := httptest.NewRequest(http.MethodPost, "/api/webhooks", bytes.NewReader(body))
	w := httptest.NewRecorder()

	s.handleSaveWebhookAdapters(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Verify config was saved and other fields preserved
	saved, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("failed to read saved config: %v", err)
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(saved, &raw); err != nil {
		t.Fatalf("failed to parse saved config: %v", err)
	}

	// Verify notifications field still exists
	if _, ok := raw["notifications"]; !ok {
		t.Error("expected notifications field to be preserved")
	}

	// Verify webhooks field was saved
	if _, ok := raw["webhooks"]; !ok {
		t.Fatal("expected webhooks field in saved config")
	}

	var savedWC WebhookConfig
	if err := json.Unmarshal(raw["webhooks"], &savedWC); err != nil {
		t.Fatalf("failed to parse saved webhooks: %v", err)
	}

	if !savedWC.Enabled {
		t.Error("expected enabled=true in saved config")
	}
	if len(savedWC.Adapters) != 1 {
		t.Fatalf("expected 1 adapter, got %d", len(savedWC.Adapters))
	}
	if savedWC.Adapters[0].Type != "discord" {
		t.Errorf("expected discord adapter, got %s", savedWC.Adapters[0].Type)
	}
}

func TestWebhookHandler_SaveAdapters_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	s := &Server{cfg: Config{RepoPath: tmpDir}}

	req := httptest.NewRequest(http.MethodPost, "/api/webhooks", bytes.NewReader([]byte("not json")))
	w := httptest.NewRecorder()

	s.handleSaveWebhookAdapters(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestWebhookHandler_TestWebhook_MissingType(t *testing.T) {
	tmpDir := t.TempDir()
	s := &Server{cfg: Config{RepoPath: tmpDir}}

	body, _ := json.Marshal(map[string]string{"webhook_url": "https://example.com"})
	req := httptest.NewRequest(http.MethodPost, "/api/webhooks/test", bytes.NewReader(body))
	w := httptest.NewRecorder()

	s.handleTestWebhook(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestWebhookHandler_TestWebhook_UnknownAdapter(t *testing.T) {
	tmpDir := t.TempDir()
	s := &Server{cfg: Config{RepoPath: tmpDir}}

	body, _ := json.Marshal(map[string]string{"type": "nonexistent"})
	req := httptest.NewRequest(http.MethodPost, "/api/webhooks/test", bytes.NewReader(body))
	w := httptest.NewRecorder()

	s.handleTestWebhook(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp["success"] != false {
		t.Error("expected success=false for unknown adapter")
	}
	if resp["error"] == nil || resp["error"] == "" {
		t.Error("expected error message for unknown adapter")
	}
}
