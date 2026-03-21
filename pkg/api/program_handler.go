package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/queue"
	"github.com/blackwell-systems/scout-and-wave-web/pkg/service"
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
	ValidationErrors []string                     `json:"validation_errors,omitempty"`
}

// ProgramListResponse is the JSON response for GET /api/programs.
type ProgramListResponse struct {
	Programs   []protocol.ProgramDiscovery `json:"programs"`
	Metrics    PipelineMetrics             `json:"metrics"`
	Standalone []PipelineEntry             `json:"standalone"`
}

// TierExecuteRequest is the JSON request body for POST /api/program/{slug}/tier/{n}/execute.
type TierExecuteRequest struct {
	Auto bool `json:"auto,omitempty"`
}

// handleListPrograms handles GET /api/programs.
// Scans all configured repos for PROGRAM-*.yaml files and returns discovery summaries,
// along with global pipeline metrics and standalone IMPLs (those not belonging to any program).
func (s *Server) handleListPrograms(w http.ResponseWriter, r *http.Request) {
	deps := s.makeDeps()
	programs, err := service.ListPrograms(deps)
	if err != nil {
		http.Error(w, "failed to list programs", http.StatusInternalServerError)
		return
	}

	repos := s.getConfiguredRepos()
	entries, metrics := buildPipelineData(repos, &s.activeRuns)

	// Filter standalone IMPLs: those with no program association
	var standalone []PipelineEntry
	for _, e := range entries {
		if e.ProgramSlug == "" {
			standalone = append(standalone, e)
		}
	}
	if standalone == nil {
		standalone = []PipelineEntry{}
	}

	resp := ProgramListResponse{
		Programs:   programs,
		Metrics:    metrics,
		Standalone: standalone,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// buildPipelineData builds pipeline entries and metrics from configured repos.
// This is the shared logic used by both handleListPrograms and handleGetPipeline.
func buildPipelineData(repos []RepoEntry, activeRuns *sync.Map) ([]PipelineEntry, PipelineMetrics) {
	implProgramMap := implProgramCacheInstance.get(repos)

	var entries []PipelineEntry
	completedCount := 0
	blockedCount := 0
	queueDepth := 0

	for _, repo := range repos {
		repoPath := repo.Path

		// 1. Count/load completed IMPLs from docs/IMPL/complete/
		completeDir := filepath.Join(repoPath, "docs", "IMPL", "complete")
		if dirEntries, err := os.ReadDir(completeDir); err == nil {
			for _, de := range dirEntries {
				name := de.Name()
				if !strings.HasPrefix(name, "IMPL-") || !strings.HasSuffix(name, ".yaml") {
					continue
				}
				completedCount++
				slug := strings.TrimSuffix(strings.TrimPrefix(name, "IMPL-"), ".yaml")
				title := slug
				fullPath := filepath.Join(completeDir, name)
				if m, err := protocol.Load(fullPath); err == nil && m.Title != "" {
					title = m.Title
				}
				entry := PipelineEntry{
					Slug:   slug,
					Title:  title,
					Status: "complete",
					Repo:   repo.Name,
				}
				if pi, ok := implProgramMap[slug]; ok {
					entry.ProgramSlug = pi.programSlug
					entry.ProgramTitle = pi.programTitle
					entry.ProgramTier = pi.programTier
					entry.ProgramTiersTotal = pi.programTiersTotal
				}
				entries = append(entries, entry)
			}
		}

		// 2. Load active IMPLs from docs/IMPL/ and check if executing
		activeDir := filepath.Join(repoPath, "docs", "IMPL")
		if dirEntries, err := os.ReadDir(activeDir); err == nil {
			for _, de := range dirEntries {
				name := de.Name()
				if !strings.HasPrefix(name, "IMPL-") || !strings.HasSuffix(name, ".yaml") {
					continue
				}
				slug := strings.TrimSuffix(strings.TrimPrefix(name, "IMPL-"), ".yaml")
				title := slug
				fullPath := filepath.Join(activeDir, name)
				if m, err := protocol.Load(fullPath); err == nil && m.Title != "" {
					title = m.Title
				}

				status := "queued"
				if _, loaded := activeRuns.Load(slug); loaded {
					status = "executing"
				}
				entry := PipelineEntry{
					Slug:   slug,
					Title:  title,
					Status: status,
					Repo:   repo.Name,
				}
				if pi, ok := implProgramMap[slug]; ok {
					entry.ProgramSlug = pi.programSlug
					entry.ProgramTitle = pi.programTitle
					entry.ProgramTier = pi.programTier
					entry.ProgramTiersTotal = pi.programTiersTotal
				}
				entries = append(entries, entry)
			}
		}

		// 3. Load queued items from queue manager
		mgr := queue.NewManager(repoPath)
		if items, err := mgr.List(); err == nil {
			for i, item := range items {
				if entryExists(entries, item.Slug) {
					if item.Status == "blocked" {
						blockedCount++
					}
					continue
				}
				status := "queued"
				if item.Status == "blocked" {
					status = "blocked"
					blockedCount++
				}
				entry := PipelineEntry{
					Slug:          item.Slug,
					Title:         item.Title,
					Status:        status,
					QueuePosition: i + 1,
					DependsOn:     item.DependsOn,
					Repo:          repo.Name,
				}
				if item.Status == "blocked" {
					entry.BlockedReason = "dependency"
				}
				if pi, ok := implProgramMap[item.Slug]; ok {
					entry.ProgramSlug = pi.programSlug
					entry.ProgramTitle = pi.programTitle
					entry.ProgramTier = pi.programTier
					entry.ProgramTiersTotal = pi.programTiersTotal
				}
				entries = append(entries, entry)
				queueDepth++
			}
		}
	}

	metrics := PipelineMetrics{
		CompletedCount: completedCount,
		QueueDepth:     queueDepth,
		BlockedCount:   blockedCount,
	}

	if entries == nil {
		entries = []PipelineEntry{}
	}

	return entries, metrics
}

// handleGetProgramStatus handles GET /api/program/{slug}.
// Returns comprehensive status for a PROGRAM manifest including execution state.
func (s *Server) handleGetProgramStatus(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	deps := s.makeDeps()
	status, err := service.GetProgramStatus(deps, slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// U4 — Pre-flight IMPL validation: check each tier's IMPL docs exist on disk.
	programPath, repoPath, _ := service.ResolveProgramPath(deps, slug)
	manifest, _ := protocol.ParseProgramManifest(programPath)
	var validationErrors []string
	if manifest != nil {
		for _, tier := range manifest.Tiers {
			for _, implSlug := range tier.Impls {
				if _, err := service.ResolveIMPLPathForProgram(implSlug, repoPath); err != nil {
					validationErrors = append(validationErrors, fmt.Sprintf("tier %d: IMPL %q not found", tier.Number, implSlug))
				}
			}
		}
	}

	// Check if any tier execution is currently running for this program
	_, isExecuting := s.activeProgramRuns.Load(slug)

	resp := ProgramStatusResponse{
		ProgramSlug:      status.ProgramSlug,
		Title:            status.Title,
		State:            string(status.State),
		CurrentTier:      status.CurrentTier,
		TierStatuses:     status.TierStatuses,
		ContractStatuses: status.ContractStatuses,
		Completion:       status.Completion,
		IsExecuting:      isExecuting,
		ValidationErrors: validationErrors,
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

	deps := s.makeDeps()
	status, err := service.GetProgramStatus(deps, slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
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

	// Decode request body (optional auto flag)
	var body TierExecuteRequest
	_ = json.NewDecoder(r.Body).Decode(&body)

	deps := s.makeDeps()
	if err := service.ExecuteTier(deps, slug, tierNum, body.Auto); err != nil {
		if err.Error() == "program tier already executing" {
			http.Error(w, err.Error(), http.StatusConflict)
		} else {
			http.Error(w, err.Error(), http.StatusNotFound)
		}
		return
	}

	// Notify that execution started
	s.globalBroker.broadcast("program_list_updated")

	w.WriteHeader(http.StatusAccepted)
}

// handleGetProgramContracts handles GET /api/program/{slug}/contracts.
// Returns the list of program contracts with their freeze status.
func (s *Server) handleGetProgramContracts(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	deps := s.makeDeps()
	status, err := service.GetProgramStatus(deps, slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status.ContractStatuses)
}

// handleReplanProgram handles POST /api/program/{slug}/replan.
// Launches the Planner agent to revise the PROGRAM manifest and returns 202 Accepted.
func (s *Server) handleReplanProgram(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	var body struct {
		Reason     string `json:"reason"`
		FailedTier int    `json:"failed_tier"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	deps := s.makeDeps()
	if err := service.ReplanProgram(deps, slug, body.Reason, body.FailedTier); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusAccepted)
}

