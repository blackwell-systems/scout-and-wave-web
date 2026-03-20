package api

import (
	"encoding/json"
	"net/http"

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

