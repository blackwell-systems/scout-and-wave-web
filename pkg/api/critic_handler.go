package api

import (
	"encoding/json"
	"net/http"
	"os/exec"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// handleGetCriticReview serves GET /api/impl/{slug}/critic-review.
// Loads the IMPL manifest for the given slug and returns the critic_report
// field as JSON. Returns 404 if the IMPL doc is not found or no critic
// review has been written yet. Returns 500 on parse errors.
func (s *Server) handleGetCriticReview(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	implPath, _ := s.findImplPath(slug)
	if implPath == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "IMPL doc not found"})
		return
	}

	manifest, err := protocol.Load(implPath)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "failed to load IMPL manifest"})
		return
	}

	result := protocol.GetCriticReview(manifest)
	if result == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "no critic review for this IMPL"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// handleRunCriticReview serves POST /api/impl/{slug}/run-critic.
// Starts the critic gate asynchronously and returns 202 immediately.
// The critic_review_complete SSE event fires when the review is written.
func (s *Server) handleRunCriticReview(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	implPath, _ := s.findImplPath(slug)
	if implPath == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "IMPL doc not found"})
		return
	}
	go s.runCriticAsync(slug, implPath)
	w.WriteHeader(http.StatusAccepted)
}

// runCriticAsync invokes sawtools run-critic and emits critic_review_complete
// when done. Safe to call in a goroutine.
func (s *Server) runCriticAsync(slug, implPath string) {
	cmd := exec.Command("sawtools", "run-critic", implPath) //nolint:gosec
	if err := cmd.Run(); err != nil {
		return // critic failure is non-fatal; UI retains prior state
	}
	manifest, err := protocol.Load(implPath)
	if err != nil {
		return
	}
	if result := protocol.GetCriticReview(manifest); result != nil {
		s.EmitCriticReviewComplete(slug, result)
	}
}

// criticThresholdMet returns true when an IMPL warrants automatic critic gating:
// wave 1 has 3+ agents OR file ownership spans 2+ distinct repos.
func criticThresholdMet(manifest *protocol.IMPLManifest) bool {
	for _, wave := range manifest.Waves {
		if wave.Number == 1 && len(wave.Agents) >= 3 {
			return true
		}
	}
	repos := make(map[string]struct{})
	for _, fo := range manifest.FileOwnership {
		if fo.Repo != "" {
			repos[fo.Repo] = struct{}{}
		}
	}
	return len(repos) >= 2
}

