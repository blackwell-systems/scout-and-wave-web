package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/config"
)

// configWithNotifications wraps the full config including notifications.
// This is used locally to read/write the notifications field without
// modifying the main config.SAWConfig type until integration.
type configWithNotifications struct {
	config.SAWConfig
	Notifications NotificationPreferences `json:"notifications"`
}

// defaultNotificationPreferences returns the default preferences when none are configured.
func defaultNotificationPreferences() NotificationPreferences {
	return NotificationPreferences{
		Enabled:       true,
		MutedTypes:    nil,
		BrowserNotify: true,
		ToastNotify:   true,
	}
}

// handleGetNotificationPrefs serves GET /api/notifications/preferences.
// Returns the current notification preferences from saw.config.json.
// If the config doesn't exist or has no notifications field, returns defaults.
func (s *Server) handleGetNotificationPrefs(w http.ResponseWriter, r *http.Request) {
	configPath := filepath.Join(s.cfg.RepoPath, "saw.config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			// No config file exists - return defaults
			respondJSON(w, http.StatusOK, defaultNotificationPreferences())
			return
		}
		http.Error(w, "failed to read config", http.StatusInternalServerError)
		return
	}

	var cfg configWithNotifications
	if err := json.Unmarshal(data, &cfg); err != nil {
		http.Error(w, "failed to parse config", http.StatusInternalServerError)
		return
	}

	// If notifications field is not set (all zero values), return defaults
	prefs := cfg.Notifications
	if !prefs.Enabled && !prefs.BrowserNotify && !prefs.ToastNotify && len(prefs.MutedTypes) == 0 {
		prefs = defaultNotificationPreferences()
	}

	respondJSON(w, http.StatusOK, prefs)
}

// handleSaveNotificationPrefs serves POST /api/notifications/preferences.
// Saves notification preferences to saw.config.json under the "notifications" key.
// Preserves all other config fields using atomic write pattern.
func (s *Server) handleSaveNotificationPrefs(w http.ResponseWriter, r *http.Request) {
	var prefs NotificationPreferences
	if err := decodeJSON(r, &prefs); err != nil {
		respondError(w, "invalid preferences JSON", http.StatusBadRequest)
		return
	}

	configPath := filepath.Join(s.cfg.RepoPath, "saw.config.json")

	// Read existing config to preserve all other fields
	var cfg configWithNotifications
	data, err := os.ReadFile(configPath)
	if err != nil && !os.IsNotExist(err) {
		http.Error(w, "failed to read existing config", http.StatusInternalServerError)
		return
	}

	// If file exists, unmarshal it; otherwise cfg starts as zero value
	if err == nil {
		if err := json.Unmarshal(data, &cfg); err != nil {
			http.Error(w, "failed to parse existing config", http.StatusInternalServerError)
			return
		}
	}

	// Update only the notifications field
	cfg.Notifications = prefs

	// Marshal to JSON
	newData, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		http.Error(w, "failed to marshal config", http.StatusInternalServerError)
		return
	}

	// Atomic write: write to temp file in same directory, then rename
	tmpFile, err := os.CreateTemp(filepath.Dir(configPath), "saw-config-*.json.tmp")
	if err != nil {
		http.Error(w, "failed to create temp file", http.StatusInternalServerError)
		return
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath) // clean up if rename fails

	if _, err := tmpFile.Write(newData); err != nil {
		tmpFile.Close()
		http.Error(w, "failed to write temp file", http.StatusInternalServerError)
		return
	}
	if err := tmpFile.Close(); err != nil {
		http.Error(w, "failed to close temp file", http.StatusInternalServerError)
		return
	}
	if err := os.Rename(tmpPath, configPath); err != nil {
		http.Error(w, "failed to save config", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}
