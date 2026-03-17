package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/resume"
)

// handleInterruptedSessions serves GET /api/sessions/interrupted.
// Scans all configured repos for interrupted SAW sessions and returns
// a JSON array of session state objects.
func (s *Server) handleInterruptedSessions(w http.ResponseWriter, r *http.Request) {
	// Read saw.config.json to get the list of repos (same pattern as handleListImpls)
	configPath := filepath.Join(s.cfg.RepoPath, "saw.config.json")
	configData, err := os.ReadFile(configPath)

	var repos []RepoEntry
	if err == nil {
		var cfg SAWConfig
		if json.Unmarshal(configData, &cfg) == nil && len(cfg.Repos) > 0 {
			repos = cfg.Repos
		}
	}

	// Fallback: if no config or no repos, use the startup repo
	if len(repos) == 0 {
		repos = []RepoEntry{{
			Name: filepath.Base(s.cfg.RepoPath),
			Path: s.cfg.RepoPath,
		}}
	}

	var allSessions []resume.SessionState

	for _, repo := range repos {
		sessions, err := resume.Detect(repo.Path)
		if err != nil {
			continue // skip repos that fail (e.g. no docs/IMPL/)
		}
		allSessions = append(allSessions, sessions...)
	}

	if allSessions == nil {
		allSessions = []resume.SessionState{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(allSessions) //nolint:errcheck
}
