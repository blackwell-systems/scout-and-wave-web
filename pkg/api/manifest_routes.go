package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/result"
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

	respondJSON(w, http.StatusOK, manifest)
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
		response["errors"] = []result.SAWError{}
	}

	respondJSON(w, http.StatusOK, response)
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

	respondJSON(w, http.StatusOK, wave)
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

	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// resolveManifestPath converts a slug to an absolute YAML manifest path.
// Scans all configured repos like handleListImpls does.
func (s *Server) resolveManifestPath(slug string) string {
	filename := "IMPL-" + slug + ".yaml"

	// Read config to get repos
	repos := s.getConfiguredRepos()

	// Scan each repo's IMPL directories
	for _, repo := range repos {
		paths := []string{
			filepath.Join(repo.Path, "docs", "IMPL", filename),
			filepath.Join(repo.Path, "docs", "IMPL", "complete", filename),
		}
		for _, p := range paths {
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	}

	// Not found in any repo, return default
	return filepath.Join(s.cfg.IMPLDir, filename)
}

// RegisterManifestRoutes registers all manifest-related HTTP routes.
func (s *Server) RegisterManifestRoutes() {
	s.mux.HandleFunc("GET /api/manifest/{slug}", s.HandleLoadManifest)
	s.mux.HandleFunc("POST /api/manifest/{slug}/validate", s.HandleValidateManifest)
	s.mux.HandleFunc("GET /api/manifest/{slug}/wave/{number}", s.HandleGetManifestWave)
	s.mux.HandleFunc("POST /api/manifest/{slug}/completion/{agentID}", s.HandleSetManifestCompletion)
}
