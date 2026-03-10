package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// HandleLoadManifest serves GET /api/manifest/{slug}.
// Loads and returns the parsed YAML manifest as JSON.
func (s *Server) HandleLoadManifest(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		http.Error(w, "missing slug", http.StatusBadRequest)
		return
	}

	yamlPath := s.resolveManifestPath(slug)
	manifest, err := LoadManifest(yamlPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to load manifest: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(manifest); err != nil {
		// Headers already written; nothing more we can do.
		return
	}
}

// HandleValidateManifest serves POST /api/manifest/{slug}/validate.
// Validates the manifest and returns validation errors if any.
func (s *Server) HandleValidateManifest(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		http.Error(w, "missing slug", http.StatusBadRequest)
		return
	}

	yamlPath := s.resolveManifestPath(slug)
	validationErrs, err := ValidateManifest(yamlPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to validate manifest: %v", err), http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"valid":  len(validationErrs) == 0,
		"errors": validationErrs,
	}
	if validationErrs == nil {
		response["errors"] = []protocol.ValidationError{}
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		// Headers already written; nothing more we can do.
		return
	}
}

// HandleGetManifestWave serves GET /api/manifest/{slug}/wave/{number}.
// Returns a specific wave from the manifest.
func (s *Server) HandleGetManifestWave(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	waveNumStr := r.PathValue("number")
	if slug == "" || waveNumStr == "" {
		http.Error(w, "missing slug or wave number", http.StatusBadRequest)
		return
	}

	waveNum, err := strconv.Atoi(waveNumStr)
	if err != nil {
		http.Error(w, "invalid wave number", http.StatusBadRequest)
		return
	}

	yamlPath := s.resolveManifestPath(slug)
	wave, err := GetManifestWave(yamlPath, waveNum)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to get wave: %v", err), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(wave); err != nil {
		// Headers already written; nothing more we can do.
		return
	}
}

// HandleSetManifestCompletion serves POST /api/manifest/{slug}/completion/{agentID}.
// Sets the completion report for an agent and saves the manifest.
func (s *Server) HandleSetManifestCompletion(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	agentID := r.PathValue("agentID")
	if slug == "" || agentID == "" {
		http.Error(w, "missing slug or agent ID", http.StatusBadRequest)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var report protocol.CompletionReport
	if err := json.Unmarshal(body, &report); err != nil {
		http.Error(w, fmt.Sprintf("invalid JSON: %v", err), http.StatusBadRequest)
		return
	}

	yamlPath := s.resolveManifestPath(slug)
	if err := SetManifestCompletion(yamlPath, agentID, report); err != nil {
		http.Error(w, fmt.Sprintf("failed to set completion: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// resolveManifestPath converts a slug to an absolute YAML manifest path.
// Follows the same convention as IMPL docs: {IMPLDir}/IMPL-{slug}.yaml
func (s *Server) resolveManifestPath(slug string) string {
	return filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".yaml")
}

// RegisterManifestRoutes registers all manifest-related HTTP routes.
func (s *Server) RegisterManifestRoutes() {
	s.mux.HandleFunc("GET /api/manifest/{slug}", s.HandleLoadManifest)
	s.mux.HandleFunc("POST /api/manifest/{slug}/validate", s.HandleValidateManifest)
	s.mux.HandleFunc("GET /api/manifest/{slug}/wave/{number}", s.HandleGetManifestWave)
	s.mux.HandleFunc("POST /api/manifest/{slug}/completion/{agentID}", s.HandleSetManifestCompletion)
}
