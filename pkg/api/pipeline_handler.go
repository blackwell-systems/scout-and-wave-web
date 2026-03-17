package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/autonomy"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/queue"
)

// PipelineEntry represents a single IMPL in the pipeline view.
type PipelineEntry struct {
	Slug          string   `json:"slug"`
	Title         string   `json:"title"`
	Status        string   `json:"status"` // complete, executing, blocked, queued
	Repo          string   `json:"repo,omitempty"`
	WaveProgress  string   `json:"wave_progress,omitempty"`
	ActiveAgent   string   `json:"active_agent,omitempty"`
	BlockedReason string   `json:"blocked_reason,omitempty"`
	QueuePosition int      `json:"queue_position,omitempty"`
	DependsOn     []string `json:"depends_on,omitempty"`
	CompletedAt   string   `json:"completed_at,omitempty"`
	ElapsedSecs   int      `json:"elapsed_seconds,omitempty"`
}

// PipelineMetrics contains throughput and status counts.
type PipelineMetrics struct {
	ImplsPerHour   float64 `json:"impls_per_hour"`
	AvgWaveSecs    float64 `json:"avg_wave_seconds"`
	QueueDepth     int     `json:"queue_depth"`
	BlockedCount   int     `json:"blocked_count"`
	CompletedCount int     `json:"completed_count"`
}

// PipelineResponse is the JSON response for GET /api/pipeline.
type PipelineResponse struct {
	Entries       []PipelineEntry `json:"entries"`
	Metrics       PipelineMetrics `json:"metrics"`
	AutonomyLevel string          `json:"autonomy_level"`
}

// handleGetPipeline serves GET /api/pipeline.
// Returns a combined view of all IMPLs across the lifecycle (completed,
// executing, queued) with throughput metrics and current autonomy level.
func (s *Server) handleGetPipeline(w http.ResponseWriter, r *http.Request) {
	repos := s.getConfiguredRepos()
	includeCompleted := r.URL.Query().Get("include_completed") == "true"

	var entries []PipelineEntry
	completedCount := 0
	blockedCount := 0
	queueDepth := 0

	for _, repo := range repos {
		repoPath := repo.Path

		// 1. Count/load completed IMPLs from docs/IMPL/complete/
		completeDir := filepath.Join(repoPath, "docs", "IMPL", "complete")
		if dirEntries, err := os.ReadDir(completeDir); err == nil {
			for _, e := range dirEntries {
				name := e.Name()
				if !strings.HasPrefix(name, "IMPL-") || !strings.HasSuffix(name, ".yaml") {
					continue
				}
				completedCount++
				if !includeCompleted {
					continue
				}
				slug := strings.TrimSuffix(strings.TrimPrefix(name, "IMPL-"), ".yaml")
				title := slug
				fullPath := filepath.Join(completeDir, name)
				if m, err := protocol.Load(fullPath); err == nil && m.Title != "" {
					title = m.Title
				}
				entries = append(entries, PipelineEntry{
					Slug:   slug,
					Title:  title,
					Status: "complete",
					Repo:   repo.Name,
				})
			}
		}

		// 2. Load active IMPLs from docs/IMPL/ and check if executing
		activeDir := filepath.Join(repoPath, "docs", "IMPL")
		if dirEntries, err := os.ReadDir(activeDir); err == nil {
			for _, e := range dirEntries {
				name := e.Name()
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
				if _, loaded := s.activeRuns.Load(slug); loaded {
					status = "executing"
				}
				entries = append(entries, PipelineEntry{
					Slug:   slug,
					Title:  title,
					Status: status,
					Repo:   repo.Name,
				})
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
				entries = append(entries, entry)
				queueDepth++
			}
		}
	}

	// 4. Load autonomy config (from primary repo)
	autonomyLevel := "gated"
	if cfg, err := autonomy.LoadConfig(s.cfg.RepoPath); err == nil {
		autonomyLevel = string(cfg.Level)
	}

	// 5. Build metrics
	metrics := PipelineMetrics{
		CompletedCount: completedCount,
		QueueDepth:     queueDepth,
		BlockedCount:   blockedCount,
	}

	if entries == nil {
		entries = []PipelineEntry{}
	}

	resp := PipelineResponse{
		Entries:       entries,
		Metrics:       metrics,
		AutonomyLevel: autonomyLevel,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// entryExists checks if a slug already exists in the entries slice.
func entryExists(entries []PipelineEntry, slug string) bool {
	for _, e := range entries {
		if e.Slug == slug {
			return true
		}
	}
	return false
}
