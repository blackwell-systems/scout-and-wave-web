package api

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-web/pkg/service"
)

// ValidateIntegrationResponse is the JSON response for
// GET /api/impl/{slug}/validate-integration?wave=N.
type ValidateIntegrationResponse struct {
	Valid bool                    `json:"valid"`
	Wave  int                     `json:"wave"`
	Gaps  []protocol.IntegrationGap `json:"gaps"`
}

// ValidateWiringResponse is the JSON response for
// GET /api/impl/{slug}/validate-wiring.
type ValidateWiringResponse struct {
	Valid bool                 `json:"valid"`
	Gaps  []protocol.WiringGap `json:"gaps"`
}

// handleValidateIntegration serves GET /api/impl/{slug}/validate-integration?wave=N.
// Runs E25 integration validation for the given wave and returns a report.
func (s *Server) handleValidateIntegration(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		respondError(w, "missing slug", http.StatusBadRequest)
		return
	}

	waveStr := r.URL.Query().Get("wave")
	if waveStr == "" {
		respondError(w, "missing wave query parameter", http.StatusBadRequest)
		return
	}

	waveNum, err := strconv.Atoi(waveStr)
	if err != nil || waveNum < 1 {
		respondError(w, "invalid wave parameter: must be a positive integer", http.StatusBadRequest)
		return
	}

	implPath, repoPath, err := service.ResolveIMPLPath(s.svcDeps, slug)
	if err != nil {
		respondError(w, fmt.Sprintf("IMPL doc not found for slug %q", slug), http.StatusNotFound)
		return
	}

	manifest, err := protocol.Load(implPath)
	if err != nil {
		respondError(w, fmt.Sprintf("failed to load manifest: %v", err), http.StatusInternalServerError)
		return
	}

	report, err := protocol.ValidateIntegration(manifest, waveNum, repoPath)
	if err != nil {
		respondError(w, fmt.Sprintf("integration validation failed: %v", err), http.StatusInternalServerError)
		return
	}

	gaps := report.Gaps
	if gaps == nil {
		gaps = []protocol.IntegrationGap{}
	}

	respondJSON(w, http.StatusOK, ValidateIntegrationResponse{
		Valid: report.Valid,
		Wave:  report.Wave,
		Gaps:  gaps,
	})
}

// handleValidateWiring serves GET /api/impl/{slug}/validate-wiring.
// Runs E35 wiring declaration validation and returns a report.
func (s *Server) handleValidateWiring(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		respondError(w, "missing slug", http.StatusBadRequest)
		return
	}

	implPath, repoPath, err := service.ResolveIMPLPath(s.svcDeps, slug)
	if err != nil {
		respondError(w, fmt.Sprintf("IMPL doc not found for slug %q", slug), http.StatusNotFound)
		return
	}

	manifest, err := protocol.Load(implPath)
	if err != nil {
		respondError(w, fmt.Sprintf("failed to load manifest: %v", err), http.StatusInternalServerError)
		return
	}

	result, err := protocol.ValidateWiringDeclarations(manifest, repoPath)
	if err != nil {
		respondError(w, fmt.Sprintf("wiring validation failed: %v", err), http.StatusInternalServerError)
		return
	}

	gaps := result.Gaps
	if gaps == nil {
		gaps = []protocol.WiringGap{}
	}

	respondJSON(w, http.StatusOK, ValidateWiringResponse{
		Valid: result.Valid,
		Gaps:  gaps,
	})
}

// RegisterValidationRoutes registers the E25/E26/E35 validation endpoints.
// Called from server.go New() alongside other route groups.
func (s *Server) RegisterValidationRoutes() {
	s.mux.HandleFunc("GET /api/impl/{slug}/validate-integration", s.handleValidateIntegration)
	s.mux.HandleFunc("GET /api/impl/{slug}/validate-wiring", s.handleValidateWiring)
}
