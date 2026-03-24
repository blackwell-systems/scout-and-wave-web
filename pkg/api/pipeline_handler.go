package api

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/config"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/queue"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/result"
)

// implProgramInfo holds the parent program identifiers for a given IMPL slug.
type implProgramInfo struct {
	programSlug       string
	programTitle      string
	programTier       int // tier number the IMPL belongs to (from ProgramIMPL.Tier)
	programTiersTotal int // total number of tiers in the PROGRAM manifest
}

// implProgramCache is a TTL cache for the result of buildImplProgramMapFresh.
type implProgramCache struct {
	mu      sync.Mutex
	data    map[string]implProgramInfo
	builtAt time.Time
	ttl     time.Duration
}

// implProgramCacheTTL is the default TTL for implProgramCacheInstance.
// Tests may set this to 0 to bypass caching.
var implProgramCacheTTL = 15 * time.Second

// implProgramCacheInstance is the package-level singleton cache.
var implProgramCacheInstance = &implProgramCache{ttl: implProgramCacheTTL}

// get returns cached data if fresh, otherwise rebuilds from repos.
func (c *implProgramCache) get(repos []config.RepoEntry) map[string]implProgramInfo {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.data != nil && c.ttl > 0 && time.Since(c.builtAt) < c.ttl {
		return c.data
	}
	c.data = buildImplProgramMapFresh(repos)
	c.builtAt = time.Now()
	return c.data
}

// buildImplProgramMapFresh scans each repo's docs/PROGRAM-*.yaml files and returns
// a map of implSlug → implProgramInfo for use in tagging pipeline entries.
// First-write-wins: if the same slug appears in multiple manifests, the first
// occurrence is kept and a warning is logged.
func buildImplProgramMapFresh(repos []config.RepoEntry) map[string]implProgramInfo {
	result := make(map[string]implProgramInfo)
	for _, repo := range repos {
		docsDir := filepath.Join(repo.Path, "docs")
		entries, err := os.ReadDir(docsDir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			name := e.Name()
			if !strings.HasPrefix(name, "PROGRAM-") || !strings.HasSuffix(name, ".yaml") {
				continue
			}
			manifest, err := protocol.ParseProgramManifest(filepath.Join(docsDir, name))
			if err != nil {
				continue
			}
			for _, impl := range manifest.Impls {
				if existing, exists := result[impl.Slug]; exists {
					log.Printf("buildImplProgramMap: slug %q claimed by both %q and %q; keeping first",
						impl.Slug, existing.programSlug, manifest.ProgramSlug)
					continue
				}
				result[impl.Slug] = implProgramInfo{
					programSlug:       manifest.ProgramSlug,
					programTitle:      manifest.Title,
					programTier:       impl.Tier,
					programTiersTotal: len(manifest.Tiers),
				}
			}
		}
	}
	return result
}

// PipelineEntry represents a single IMPL in the pipeline view.
type PipelineEntry struct {
	Slug              string   `json:"slug"`
	Title             string   `json:"title"`
	Status            string   `json:"status"` // complete, executing, blocked, queued
	Repo              string   `json:"repo,omitempty"`
	WaveProgress      string   `json:"wave_progress,omitempty"`
	ActiveAgent       string   `json:"active_agent,omitempty"`
	BlockedReason     string   `json:"blocked_reason,omitempty"`
	QueuePosition     int      `json:"queue_position,omitempty"`
	DependsOn         []string `json:"depends_on,omitempty"`
	CompletedAt       string   `json:"completed_at,omitempty"`
	ElapsedSecs       int      `json:"elapsed_seconds,omitempty"`
	ProgramSlug       string   `json:"program_slug,omitempty"`
	ProgramTitle      string   `json:"program_title,omitempty"`
	ProgramTier       int      `json:"program_tier,omitempty"`
	ProgramTiersTotal int      `json:"program_tiers_total,omitempty"`
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
				if r := loadManifestResult(fullPath); r.IsSuccess() && r.GetData().Title != "" {
					title = r.GetData().Title
				}
				e := PipelineEntry{
					Slug:   slug,
					Title:  title,
					Status: "complete",
					Repo:   repo.Name,
				}
				if pi, ok := implProgramMap[slug]; ok {
					e.ProgramSlug = pi.programSlug
					e.ProgramTitle = pi.programTitle
					e.ProgramTier = pi.programTier
					e.ProgramTiersTotal = pi.programTiersTotal
				}
				entries = append(entries, e)
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
				if r := loadManifestResult(fullPath); r.IsSuccess() && r.GetData().Title != "" {
					title = r.GetData().Title
				}

				status := "queued"
				if _, loaded := s.activeRuns.Load(slug); loaded {
					status = "executing"
				}
				e := PipelineEntry{
					Slug:   slug,
					Title:  title,
					Status: status,
					Repo:   repo.Name,
				}
				if pi, ok := implProgramMap[slug]; ok {
					e.ProgramSlug = pi.programSlug
					e.ProgramTitle = pi.programTitle
					e.ProgramTier = pi.programTier
					e.ProgramTiersTotal = pi.programTiersTotal
				}
				entries = append(entries, e)
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

	// 4. Load autonomy config (from primary repo)
	autonomyLevel := "gated"
	sawCfg := config.LoadOrDefault(s.cfg.RepoPath)
	if sawCfg != nil && sawCfg.Autonomy.Level != "" {
		autonomyLevel = sawCfg.Autonomy.Level
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

// loadManifestResult wraps protocol.Load into a Result[protocol.IMPLManifest],
// providing unified success-checking via .IsSuccess() across pipeline handler callsites.
func loadManifestResult(path string) result.Result[protocol.IMPLManifest] {
	m, err := protocol.Load(path)
	if err != nil || m == nil {
		return result.NewFailure[protocol.IMPLManifest]([]result.SAWError{
			{
				Code:     "E001",
				Message:  "failed to load IMPL manifest",
				Severity: "fatal",
				File:     path,
			},
		})
	}
	return result.NewSuccess(*m)
}
