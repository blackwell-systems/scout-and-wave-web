package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
)

// validateModelName ensures model name contains only safe characters.
// Returns error if validation fails (injection prevention).
func validateModelName(model string) error {
	if model == "" {
		return nil // empty is allowed (falls back to defaults)
	}
	if len(model) > 200 {
		return fmt.Errorf("model name too long (max 200 chars)")
	}
	// Allow alphanumeric, hyphens, dots, colons, underscores, slashes
	matched, _ := regexp.MatchString(`^[a-zA-Z0-9:._/-]+$`, model)
	if !matched {
		return fmt.Errorf("model name contains invalid characters")
	}
	return nil
}

// handleGetConfig serves GET /api/config.
// Reads saw.config.json from the repo root and returns it as SAWConfig JSON.
// If the file does not exist, returns a default SAWConfig{}.
func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	configPath := filepath.Join(s.cfg.RepoPath, "saw.config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Return default config with server startup repo
			repoName := filepath.Base(s.cfg.RepoPath)
			defaultCfg := SAWConfig{
				Repos: []RepoEntry{{Name: repoName, Path: s.cfg.RepoPath}},
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(defaultCfg) //nolint:errcheck
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

	// Backward-compat: if no repos registry, use legacy repo.path or server startup repo
	if len(cfg.Repos) == 0 {
		if cfg.Repo.Path != "" {
			cfg.Repos = []RepoEntry{{Name: "repo", Path: cfg.Repo.Path}}
		} else {
			// Use server startup repo as fallback
			repoName := filepath.Base(s.cfg.RepoPath)
			cfg.Repos = []RepoEntry{{Name: repoName, Path: s.cfg.RepoPath}}
		}
	}
	cfg.Repo = RepoConfig{} // clear legacy field from response

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

	// Validate model names to prevent injection attacks
	if err := validateModelName(cfg.Agent.ScoutModel); err != nil {
		http.Error(w, "invalid scout_model: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := validateModelName(cfg.Agent.WaveModel); err != nil {
		http.Error(w, "invalid wave_model: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := validateModelName(cfg.Agent.ChatModel); err != nil {
		http.Error(w, "invalid chat_model: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := validateModelName(cfg.Agent.IntegrationModel); err != nil {
		http.Error(w, "invalid integration_model: "+err.Error(), http.StatusBadRequest)
		return
	}

	cfg.Repo = RepoConfig{} // ensure legacy field is never written back

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
