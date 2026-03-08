package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
)

// handleGetConfig serves GET /api/config.
// Reads saw.config.json from the repo root and returns it as SAWConfig JSON.
// If the file does not exist, returns a default SAWConfig{}.
func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	configPath := filepath.Join(s.cfg.RepoPath, "saw.config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Return default config
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(SAWConfig{}) //nolint:errcheck
			return
		}
		http.Error(w, "failed to read config", http.StatusInternalServerError)
		return
	}

	var cfg SAWConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		http.Error(w, "failed to parse config", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg) //nolint:errcheck
}

// handleSaveConfig serves POST /api/config.
// Decodes SAWConfig JSON body and atomically writes it to saw.config.json.
func (s *Server) handleSaveConfig(w http.ResponseWriter, r *http.Request) {
	var cfg SAWConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		http.Error(w, "invalid config JSON", http.StatusBadRequest)
		return
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		http.Error(w, "failed to marshal config", http.StatusInternalServerError)
		return
	}

	configPath := filepath.Join(s.cfg.RepoPath, "saw.config.json")

	// Atomic write: write to temp file in same directory, then rename
	tmpFile, err := os.CreateTemp(filepath.Dir(configPath), "saw-config-*.json.tmp")
	if err != nil {
		http.Error(w, "failed to create temp file", http.StatusInternalServerError)
		return
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath) // clean up if rename fails

	if _, err := tmpFile.Write(data); err != nil {
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
