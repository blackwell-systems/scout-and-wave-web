package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// ProgramStatusResponse wraps protocol.ProgramStatusResult with web-specific fields.
type ProgramStatusResponse struct {
	ProgramSlug      string                       `json:"program_slug"`
	Title            string                       `json:"title"`
	State            string                       `json:"state"`
	CurrentTier      int                          `json:"current_tier"`
	TierStatuses     []protocol.TierStatusDetail  `json:"tier_statuses"`
	ContractStatuses []protocol.ContractStatus    `json:"contract_statuses"`
	Completion       protocol.ProgramCompletion   `json:"completion"`
	IsExecuting      bool                         `json:"is_executing"`
}

// ProgramListResponse is the JSON response for GET /api/programs.
type ProgramListResponse struct {
	Programs []protocol.ProgramDiscovery `json:"programs"`
}

// TierExecuteRequest is the JSON request body for POST /api/program/{slug}/tier/{n}/execute.
type TierExecuteRequest struct {
	Auto bool `json:"auto,omitempty"`
}

// activeProgramRuns tracks in-progress program tier executions.
// This is added as a field to Server in this file (not server.go).
var activeProgramRuns sync.Map

// handleListPrograms handles GET /api/programs.
// Scans all configured repos for PROGRAM-*.yaml files and returns discovery summaries.
func (s *Server) handleListPrograms(w http.ResponseWriter, r *http.Request) {
	repos := s.getConfiguredRepos()

	var allPrograms []protocol.ProgramDiscovery

	// Scan each repo's docs/ directory for PROGRAM-*.yaml files
	for _, repo := range repos {
		docsDir := filepath.Join(repo.Path, "docs")
		programs, err := protocol.ListPrograms(docsDir)
		if err != nil {
			// Non-fatal: skip this repo if ListPrograms fails
			continue
		}
		allPrograms = append(allPrograms, programs...)
	}

	if allPrograms == nil {
		allPrograms = []protocol.ProgramDiscovery{}
	}

	resp := ProgramListResponse{Programs: allPrograms}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleGetProgramStatus handles GET /api/program/{slug}.
// Returns comprehensive status for a PROGRAM manifest including execution state.
func (s *Server) handleGetProgramStatus(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	programPath, repoPath, err := s.resolveProgramPath(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	manifest, err := protocol.ParseProgramManifest(programPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to parse program manifest: %v", err), http.StatusInternalServerError)
		return
	}

	status, err := protocol.GetProgramStatus(manifest, repoPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to get program status: %v", err), http.StatusInternalServerError)
		return
	}

	// Check if any tier execution is currently running for this program
	_, isExecuting := activeProgramRuns.Load(slug)

	resp := ProgramStatusResponse{
		ProgramSlug:      status.ProgramSlug,
		Title:            status.Title,
		State:            string(status.State),
		CurrentTier:      status.CurrentTier,
		TierStatuses:     status.TierStatuses,
		ContractStatuses: status.ContractStatuses,
		Completion:       status.Completion,
		IsExecuting:      isExecuting,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleGetTierStatus handles GET /api/program/{slug}/tier/{n}.
// Returns status for a single tier within the program.
func (s *Server) handleGetTierStatus(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	tierStr := r.PathValue("n")

	tierNum, err := strconv.Atoi(tierStr)
	if err != nil || tierNum < 1 {
		http.Error(w, "invalid tier number", http.StatusBadRequest)
		return
	}

	programPath, repoPath, err := s.resolveProgramPath(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	manifest, err := protocol.ParseProgramManifest(programPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to parse program manifest: %v", err), http.StatusInternalServerError)
		return
	}

	status, err := protocol.GetProgramStatus(manifest, repoPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to get program status: %v", err), http.StatusInternalServerError)
		return
	}

	// Find the requested tier
	var tierStatus *protocol.TierStatusDetail
	for i := range status.TierStatuses {
		if status.TierStatuses[i].Number == tierNum {
			tierStatus = &status.TierStatuses[i]
			break
		}
	}

	if tierStatus == nil {
		http.Error(w, fmt.Sprintf("tier %d not found", tierNum), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tierStatus)
}

// handleExecuteTier handles POST /api/program/{slug}/tier/{n}/execute.
// Launches tier execution in a background goroutine and returns 202 Accepted.
func (s *Server) handleExecuteTier(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	tierStr := r.PathValue("n")

	tierNum, err := strconv.Atoi(tierStr)
	if err != nil || tierNum < 1 {
		http.Error(w, "invalid tier number", http.StatusBadRequest)
		return
	}

	// Check for concurrent execution
	if _, loaded := activeProgramRuns.LoadOrStore(slug, struct{}{}); loaded {
		http.Error(w, "program tier already executing", http.StatusConflict)
		return
	}

	_, _, err = s.resolveProgramPath(slug)
	if err != nil {
		activeProgramRuns.Delete(slug)
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// Decode request body (optional auto flag)
	var body TierExecuteRequest
	_ = json.NewDecoder(r.Body).Decode(&body)

	publish := s.makeProgramPublisher(slug)

	// Notify that execution started
	s.globalBroker.broadcast("program_list_updated")

	// Launch tier execution in background (stub for now — implementation by Agent D)
	go func() {
		defer activeProgramRuns.Delete(slug)
		defer s.globalBroker.broadcast("program_list_updated")

		// Placeholder: runProgramTier will be implemented by Agent D
		// For now, just emit a started and complete event for testing
		publish("program_tier_started", map[string]interface{}{
			"program_slug": slug,
			"tier":         tierNum,
		})

		// TODO: Call runProgramTier(programPath, slug, tierNum, repoPath, publish)
		// programPath and repoPath will be resolved again inside runProgramTier
		publish("program_tier_complete", map[string]interface{}{
			"program_slug": slug,
			"tier":         tierNum,
		})
	}()

	w.WriteHeader(http.StatusAccepted)
}

// handleGetProgramContracts handles GET /api/program/{slug}/contracts.
// Returns the list of program contracts with their freeze status.
func (s *Server) handleGetProgramContracts(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	programPath, repoPath, err := s.resolveProgramPath(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	manifest, err := protocol.ParseProgramManifest(programPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to parse program manifest: %v", err), http.StatusInternalServerError)
		return
	}

	status, err := protocol.GetProgramStatus(manifest, repoPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to get program status: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status.ContractStatuses)
}

// handleReplanProgram handles POST /api/program/{slug}/replan.
// Placeholder endpoint — returns 501 Not Implemented.
func (s *Server) handleReplanProgram(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotImplemented)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Planner re-engagement not yet implemented (Phase 4)",
	})
}

// resolveProgramPath searches all configured repos for PROGRAM-{slug}.yaml.
// Returns (programPath, repoPath, nil) on success, or error if not found.
func (s *Server) resolveProgramPath(slug string) (string, string, error) {
	repos := s.getConfiguredRepos()

	for _, repo := range repos {
		docsDir := filepath.Join(repo.Path, "docs")
		programPath := filepath.Join(docsDir, fmt.Sprintf("PROGRAM-%s.yaml", slug))

		if _, err := os.Stat(programPath); err == nil {
			return programPath, repo.Path, nil
		}
	}

	return "", "", fmt.Errorf("PROGRAM doc not found for slug: %s", slug)
}

// makeProgramPublisher creates an SSE publisher function for program events.
// This mirrors makePublisher but uses a program-specific broker pattern.
func (s *Server) makeProgramPublisher(slug string) func(event string, data interface{}) {
	return func(event string, data interface{}) {
		ev := SSEEvent{Event: event, Data: data}
		// Use the same broker as wave events for now — this allows frontend
		// to connect to /api/wave/{slug}/events and receive program events
		s.broker.Publish(slug, ev)
	}
}
