package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/notify"
)

// WebhookAdapterConfig represents a single adapter entry in the config file.
type WebhookAdapterConfig struct {
	Type       string `json:"type"`
	WebhookURL string `json:"webhook_url,omitempty"`
	Channel    string `json:"channel,omitempty"`
	BotToken   string `json:"bot_token,omitempty"`
	ChatID     string `json:"chat_id,omitempty"`
}

// WebhookConfig holds the top-level webhooks config section.
type WebhookConfig struct {
	Enabled  bool                   `json:"enabled"`
	Adapters []WebhookAdapterConfig `json:"adapters,omitempty"`
}

// configWithWebhooks wraps the full config including webhooks.
// Follows the same pattern as configWithNotifications.
type configWithWebhooks struct {
	Webhooks json.RawMessage `json:"webhooks,omitempty"`
}

// readWebhookConfig reads the webhook config from saw.config.json.
func readWebhookConfig(configPath string) (WebhookConfig, error) {
	var wc WebhookConfig

	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return wc, nil
		}
		return wc, err
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return wc, err
	}

	if webhooksRaw, ok := raw["webhooks"]; ok {
		if err := json.Unmarshal(webhooksRaw, &wc); err != nil {
			return wc, err
		}
	}

	return wc, nil
}

// writeWebhookConfig writes the webhook config to saw.config.json,
// preserving all other fields using atomic write.
func writeWebhookConfig(configPath string, wc WebhookConfig) error {
	// Read existing config to preserve other fields
	var raw map[string]json.RawMessage

	data, err := os.ReadFile(configPath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	if err == nil {
		if err := json.Unmarshal(data, &raw); err != nil {
			return err
		}
	} else {
		raw = make(map[string]json.RawMessage)
	}

	// Marshal and set the webhooks field
	wcData, err := json.Marshal(wc)
	if err != nil {
		return err
	}
	raw["webhooks"] = wcData

	// Marshal the full config
	newData, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}

	// Atomic write
	tmpFile, err := os.CreateTemp(filepath.Dir(configPath), "saw-config-*.json.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	if _, err := tmpFile.Write(newData); err != nil {
		tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, configPath)
}

// handleGetWebhookAdapters serves GET /api/webhooks.
// Returns the current webhook adapter configuration from saw.config.json.
func (s *Server) handleGetWebhookAdapters(w http.ResponseWriter, r *http.Request) {
	configPath := filepath.Join(s.cfg.RepoPath, "saw.config.json")
	wc, err := readWebhookConfig(configPath)
	if err != nil {
		http.Error(w, "failed to read webhook config", http.StatusInternalServerError)
		return
	}
	respondJSON(w, http.StatusOK, wc)
}

// handleSaveWebhookAdapters serves POST /api/webhooks.
// Saves webhook adapter configuration to saw.config.json under the "webhooks" key.
func (s *Server) handleSaveWebhookAdapters(w http.ResponseWriter, r *http.Request) {
	var wc WebhookConfig
	if err := decodeJSON(r, &wc); err != nil {
		respondError(w, "invalid webhook config JSON", http.StatusBadRequest)
		return
	}

	configPath := filepath.Join(s.cfg.RepoPath, "saw.config.json")
	if err := writeWebhookConfig(configPath, wc); err != nil {
		http.Error(w, "failed to save webhook config", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// handleTestWebhook serves POST /api/webhooks/test.
// Sends a test notification event through the webhook bridge and returns success/failure.
func (s *Server) handleTestWebhook(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Type       string `json:"type"`
		WebhookURL string `json:"webhook_url,omitempty"`
		Channel    string `json:"channel,omitempty"`
		BotToken   string `json:"bot_token,omitempty"`
		ChatID     string `json:"chat_id,omitempty"`
	}
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, "invalid test request JSON", http.StatusBadRequest)
		return
	}

	if req.Type == "" {
		respondError(w, "adapter type is required", http.StatusBadRequest)
		return
	}

	// Build config map from request fields
	cfg := map[string]string{}
	if req.WebhookURL != "" {
		cfg["webhook_url"] = req.WebhookURL
	}
	if req.Channel != "" {
		cfg["channel"] = req.Channel
	}
	if req.BotToken != "" {
		cfg["bot_token"] = req.BotToken
	}
	if req.ChatID != "" {
		cfg["chat_id"] = req.ChatID
	}

	// Create adapter from registry
	adapter, err := notify.NewFromConfig(req.Type, cfg)
	if err != nil {
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	// Send test event
	testEvent := notify.Event{
		Type:      "test",
		Severity:  notify.SeverityInfo,
		Title:     "SAW Webhook Test",
		Body:      "This is a test notification from Scout-and-Wave.",
		Fields:    map[string]string{"source": "webhook_test"},
		Timestamp: time.Now(),
	}

	formatter := DefaultFormatter{}
	msg := formatter.Format(testEvent)

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if err := adapter.Send(ctx, msg); err != nil {
		respondJSON(w, http.StatusOK, map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
	})
}
