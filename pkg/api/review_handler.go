package api

import (
	"net/http"
)

// handleGetReview serves GET /api/wave/{slug}/review/{wave}.
// Returns the most recent code_review_result SSE payload for the given
// slug and wave from the pipelineTracker state. Returns 404 if no review
// has run yet for this wave.
//
// NOTE: The SSE event ("code_review_result") is the primary delivery
// mechanism. This handler enables a polling fallback for clients that
// cannot maintain a persistent SSE connection. Route registration is
// performed by Agent E (integration wave) in server.go.
func (s *Server) handleGetReview(w http.ResponseWriter, r *http.Request) {
	// TODO: implementation — look up the cached code_review_result for
	// this slug/wave from pipelineTracker or an in-memory store once that
	// is wired up by the integration wave.
	// For now, return 404 with a descriptive message.
	http.Error(w, "no review data for this wave", http.StatusNotFound)
}
