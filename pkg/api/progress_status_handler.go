package api

import (
	"encoding/json"
	"net/http"
)

// handleWaveStatus serves GET /api/wave/{slug}/status.
// Returns the current progress for all agents in the active wave.
func (s *Server) handleWaveStatus(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	entries := s.progressTracker.GetAll(slug)
	if entries == nil {
		entries = []*AgentProgress{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries) //nolint:errcheck
}
