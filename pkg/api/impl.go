package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/config"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-web/pkg/service"
)

// implCache is an in-memory cache for parsed IMPL doc metadata used by
// handleListImpls. Uses sync.RWMutex for concurrent read access and
// fsnotify-based invalidation.
type implCache struct {
	mu      sync.RWMutex
	entries map[string]cachedImplEntry // key: absolute file path
	valid   bool
}

// cachedImplEntry holds a cached implListEntry plus the file modification time
// for staleness checking during cache rebuilds.
type cachedImplEntry struct {
	entry   implListEntry
	modTime time.Time
}

// InvalidateImplCache marks the cache as stale so the next handleListImpls
// call rebuilds it. Safe for concurrent use.
func (c *implCache) Invalidate() {
	c.mu.Lock()
	c.valid = false
	c.mu.Unlock()
}

// get returns the cached entries if the cache is valid, otherwise returns nil.
func (c *implCache) get() map[string]cachedImplEntry {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if !c.valid {
		return nil
	}
	return c.entries
}

// set replaces the cache entries and marks the cache as valid.
func (c *implCache) set(entries map[string]cachedImplEntry) {
	c.mu.Lock()
	c.entries = entries
	c.valid = true
	c.mu.Unlock()
}

// implListEntry is one item in the GET /api/impl response.
type implListEntry struct {
	Slug         string   `json:"slug"`
	Repo         string   `json:"repo"`           // repo name (from saw.config.json) this IMPL belongs to
	RepoPath     string   `json:"repo_path"`      // absolute path to the repo
	DocStatus    string   `json:"doc_status"`     // "active" or "complete"
	WaveCount    int      `json:"wave_count"`     // number of waves (0 if not yet planned)
	AgentCount   int      `json:"agent_count"`    // total agents across all waves
	IsMultiRepo   bool     `json:"is_multi_repo"`   // true when file ownership spans 2+ repos
	InvolvedRepos []string `json:"involved_repos"`  // list of repo names from file ownership (for multirepo IMPLs)
	IsExecuting   bool     `json:"is_executing"`    // true when wave/scout/merge/test is in progress
}

// handleListImpls serves GET /api/impl and returns a JSON array of impl entries.
// Delegates to service.ListImpls and computes isExecuting from live server state.
func (s *Server) handleListImpls(w http.ResponseWriter, r *http.Request) {
	deps := s.makeDeps()
	entries, err := service.ListImpls(deps)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Build result, computing isExecuting live from server state
	result := make([]implListEntry, 0, len(entries))
	for _, e := range entries {
		slug := e.Slug
		_, waveActive := s.activeRuns.Load(slug)
		_, merging := s.mergingRuns.Load(slug)
		_, testing := s.testingRuns.Load(slug)
		isExecuting := waveActive || merging || testing
		if !isExecuting {
			s.scoutRuns.Range(func(key, _ any) bool {
				if runID, ok := key.(string); ok && strings.HasPrefix(runID, slug) {
					isExecuting = true
					return false
				}
				return true
			})
		}

		result = append(result, implListEntry{
			Slug:          e.Slug,
			Repo:          e.Repo,
			RepoPath:      e.RepoPath,
			DocStatus:     e.DocStatus,
			WaveCount:     e.WaveCount,
			AgentCount:    e.AgentCount,
			IsMultiRepo:   e.IsMultiRepo,
			InvolvedRepos: e.InvolvedRepos,
			IsExecuting:   isExecuting,
		})
	}

	if len(result) == 0 {
		result = []implListEntry{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// InvalidateImplCache marks the IMPL list cache as stale so it is rebuilt
// on the next request. Safe for concurrent use.
func (s *Server) InvalidateImplCache() {
	s.implListCache.Invalidate()
}

// findImplPath is a helper that searches all configured repos for an IMPL doc by slug.
// Returns the absolute file path and matched repo, or empty string if not found.
// This is kept in the API layer for backward compatibility with other handlers.
func (s *Server) findImplPath(slug string) (string, config.RepoEntry) {
	deps := s.makeDeps()
	path, repo, err := service.FindImplPath(deps, slug)
	if err != nil {
		return "", config.RepoEntry{}
	}
	return path, repo
}

// handleGetImpl serves GET /api/impl/{slug}.
// Delegates to service.GetImpl and returns IMPLDocResponse as JSON.
func (s *Server) handleGetImpl(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	deps := s.makeDeps()
	manifest, repoName, repo, err := service.GetImpl(deps, slug)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	resp := implDocResponseFromManifest(slug, manifest)
	resp.Repo = repoName
	resp.RepoPath = repo.Path

	// Populate program membership from cache
	implProgramMap := implProgramCacheInstance.get(s.getConfiguredRepos())
	if pi, ok := implProgramMap[slug]; ok {
		resp.ProgramSlug = pi.programSlug
		resp.ProgramTitle = pi.programTitle
		resp.ProgramTier = pi.programTier
		resp.ProgramTiersTotal = pi.programTiersTotal
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		// Headers already written; nothing more we can do.
		return
	}
}

// handleApprove serves POST /api/impl/{slug}/approve.
// Delegates to service.ApproveImpl and returns 202.
func (s *Server) handleApprove(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	deps := s.makeDeps()
	if err := service.ApproveImpl(deps, slug); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.globalBroker.broadcast("impl_list_updated") // status change visible in sidebar

	// Auto-trigger critic gate if threshold is met (E37).
	// Runs async so the 202 response returns immediately.
	implPath, repo, err := service.FindImplPath(deps, slug)
	if err == nil {
		if manifest, loadErr := protocol.Load(context.Background(), implPath); loadErr == nil && criticThresholdMet(manifest) {
			go s.runCriticAsync(slug, implPath)
		}
	}
	_ = repo // unused here, but returned by FindImplPath

	w.WriteHeader(http.StatusAccepted)
}

// handleReject serves POST /api/impl/{slug}/reject.
// Delegates to service.RejectImpl and returns 202.
func (s *Server) handleReject(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	deps := s.makeDeps()
	if err := service.RejectImpl(deps, slug); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.globalBroker.broadcast("impl_list_updated") // status change visible in sidebar
	w.WriteHeader(http.StatusAccepted)
}



// implDocResponseFromManifest maps a YAML *protocol.IMPLManifest to IMPLDocResponse.
// Used by handleGetImpl for .yaml IMPL docs (Scout v0.6.0+).
func implDocResponseFromManifest(slug string, m *protocol.IMPLManifest) IMPLDocResponse {
	docStatus := "active"
	if m.State == protocol.StateComplete || m.CompletionDate != "" {
		docStatus = "complete"
	}

	// File ownership
	foEntries := make([]FileOwnershipEntry, 0, len(m.FileOwnership))
	for _, fo := range m.FileOwnership {
		foEntries = append(foEntries, FileOwnershipEntry{
			File:      fo.File,
			Agent:     fo.Agent,
			Wave:      fo.Wave,
			Action:    fo.Action,
			DependsOn: strings.Join(fo.DependsOn, ", "),
			Repo:      fo.Repo,
		})
	}

	// Waves
	waveInfos := make([]WaveInfo, 0, len(m.Waves))
	for _, w := range m.Waves {
		agents := make([]string, 0, len(w.Agents))
		for _, a := range w.Agents {
			agents = append(agents, a.ID)
		}
		// Derive wave status from completion reports
		waveStatus := "pending"
		if len(m.CompletionReports) > 0 && len(agents) > 0 {
			completeCount := 0
			for _, a := range w.Agents {
				if cr, ok := m.CompletionReports[a.ID]; ok && cr.Status == "complete" {
					completeCount++
				}
			}
			if completeCount == len(agents) {
				waveStatus = "complete"
			} else if completeCount > 0 {
				waveStatus = "partial"
			}
		}
		waveInfos = append(waveInfos, WaveInfo{
			Number:       w.Number,
			Agents:       agents,
			Dependencies: []int{},
			Status:       waveStatus,
		})
	}

	// Scaffolds
	scaffoldFiles := make([]string, 0, len(m.Scaffolds))
	scaffoldDetail := make([]ScaffoldFileEntry, 0, len(m.Scaffolds))
	for _, sf := range m.Scaffolds {
		scaffoldFiles = append(scaffoldFiles, sf.FilePath)
		scaffoldDetail = append(scaffoldDetail, ScaffoldFileEntry{
			FilePath:   sf.FilePath,
			Contents:   sf.Contents,
			ImportPath: sf.ImportPath,
		})
	}

	// Known issues
	knownIssues := make([]KnownIssueEntry, 0, len(m.KnownIssues))
	for _, ki := range m.KnownIssues {
		knownIssues = append(knownIssues, KnownIssueEntry{
			Description: ki.Description,
			Status:      ki.Status,
			Workaround:  ki.Workaround,
		})
	}

	// Pre-mortem
	var preMortem *PreMortemEntry
	if m.PreMortem != nil {
		rows := make([]PreMortemRowEntry, 0, len(m.PreMortem.Rows))
		for _, r := range m.PreMortem.Rows {
			rows = append(rows, PreMortemRowEntry{
				Scenario:   r.Scenario,
				Likelihood: r.Likelihood,
				Impact:     r.Impact,
				Mitigation: r.Mitigation,
			})
		}
		preMortem = &PreMortemEntry{OverallRisk: m.PreMortem.OverallRisk, Rows: rows}
	}

	// Wiring declarations (E35)
	var wiringEntries []WiringEntry
	if len(m.Wiring) > 0 {
		wiringEntries = make([]WiringEntry, 0, len(m.Wiring))
		for _, w := range m.Wiring {
			status := "declared"
			// Check integration_reports for wiring gap status
			// If a wiring_validation_report exists and this symbol has a gap, set "gap"
			// For now, derive from wiring_report in integration reports if available.
			// Simple heuristic: if any integration_report wave has Valid=false and
			// the manifest has wiring entries, mark as potentially gap.
			// Full status resolution done by Agent G's SSE events.
			wiringEntries = append(wiringEntries, WiringEntry{
				Symbol:             w.Symbol,
				DefinedIn:          w.DefinedIn,
				MustBeCalledFrom:   w.MustBeCalledFrom,
				Agent:              w.Agent,
				Wave:               w.Wave,
				IntegrationPattern: w.IntegrationPattern,
				Status:             status,
			})
		}
	}
	if wiringEntries == nil {
		wiringEntries = []WiringEntry{}
	}

	// Interface contracts as text (name + definition per contract)
	var contractsBuf strings.Builder
	for _, ic := range m.InterfaceContracts {
		contractsBuf.WriteString("### " + ic.Name + "\n")
		if ic.Description != "" {
			contractsBuf.WriteString(ic.Description + "\n")
		}
		contractsBuf.WriteString("```\n" + ic.Definition + "\n```\n")
		if ic.Location != "" {
			contractsBuf.WriteString("Location: " + ic.Location + "\n")
		}
		contractsBuf.WriteString("\n")
	}

	// Agent prompts
	agentPrompts := []AgentPromptEntry{}
	for _, w := range m.Waves {
		for _, a := range w.Agents {
			agentPrompts = append(agentPrompts, AgentPromptEntry{
				Wave:   w.Number,
				Agent:  a.ID,
				Prompt: a.Task,
			})
		}
	}

	// Synthesize dependency graph text from waves + file ownership for the
	// DependencyGraphPanel SVG renderer. Format matches the markdown typed block
	// parser output: "Wave N (...)\n  [ID] description\n    depends on: [X] [Y]"
	var depGraphBuf strings.Builder
	// Build agent->dependencies map from file ownership depends_on fields.
	agentDeps := make(map[string]map[string]bool)
	for _, fo := range m.FileOwnership {
		if len(fo.DependsOn) > 0 {
			if agentDeps[fo.Agent] == nil {
				agentDeps[fo.Agent] = make(map[string]bool)
			}
			for _, d := range fo.DependsOn {
				agentDeps[fo.Agent][d] = true
			}
		}
	}
	depGraphBuf.WriteString("```\n")
	// Add scaffold as Wave 0 if scaffolds exist
	if len(m.Scaffolds) > 0 {
		depGraphBuf.WriteString("Wave 0 (scaffold)\n")
		depGraphBuf.WriteString("  [Scaffold] shared type definitions\n")
	}
	for _, w := range m.Waves {
		if w.Number == 1 && len(m.Scaffolds) > 0 {
			depGraphBuf.WriteString(fmt.Sprintf("Wave %d (depends on Wave 0)\n", w.Number))
		} else if w.Number == 1 {
			depGraphBuf.WriteString(fmt.Sprintf("Wave %d (parallel)\n", w.Number))
		} else {
			depGraphBuf.WriteString(fmt.Sprintf("Wave %d (depends on Wave %d)\n", w.Number, w.Number-1))
		}
		for _, a := range w.Agents {
			desc := a.ID
			if len(a.Files) > 0 {
				desc = a.Files[0]
			}
			depGraphBuf.WriteString(fmt.Sprintf("  [%s] %s\n", a.ID, desc))
			// Collect deps from both agent-level dependencies and file ownership.
			deps := make(map[string]bool)
			for _, d := range a.Dependencies {
				deps[d] = true
			}
			for d := range agentDeps[a.ID] {
				deps[d] = true
			}
			// Wave 1 agents implicitly depend on Scaffold if scaffolds exist
			if w.Number == 1 && len(m.Scaffolds) > 0 {
				deps["Scaffold"] = true
			}
			if len(deps) > 0 {
				depGraphBuf.WriteString("    depends on:")
				// Sort for determinism.
				sortedDeps := make([]string, 0, len(deps))
				for d := range deps {
					sortedDeps = append(sortedDeps, d)
				}
				sort.Strings(sortedDeps)
				for _, d := range sortedDeps {
					depGraphBuf.WriteString(" [" + d + "]")
				}
				depGraphBuf.WriteString("\n")
			}
		}
	}
	depGraphBuf.WriteString("```\n")

	return IMPLDocResponse{
		Slug:           slug,
		DocStatus:      docStatus,
		CompletedAt:    m.CompletionDate,
		OriginalBranch: m.OriginalBranch,
		Suitability: SuitabilityInfo{
			Verdict:   m.Verdict,
			Rationale: m.SuitabilityAssessment,
		},
		FileOwnership: foEntries,
		Waves:         waveInfos,
		Scaffold: ScaffoldInfo{
			Required:  len(scaffoldFiles) > 0,
			Committed: allScaffoldsCommitted(m.Scaffolds),
			Files:     scaffoldFiles,
			Contracts: []ContractEntry{},
		},
		PreMortem:              preMortem,
		Reactions:              m.Reactions,
		KnownIssues:            knownIssues,
		ScaffoldsDetail:        scaffoldDetail,
		InterfaceContractsText: contractsBuf.String(),
		DependencyGraphText:    depGraphBuf.String(),
		AgentPrompts:           agentPrompts,
		QualityGates:           convertQualityGates(m.QualityGates),
		PostMergeChecklist:     convertPostMergeChecklist(m.PostMergeChecklist),
		StubReportText:         formatStubReports(m.StubReports),
		KnownIssuesStructured:  convertKnownIssues(m.KnownIssues),
		Wiring:                 wiringEntries,
	}
}


// convertQualityGates converts protocol.QualityGates to api.QualityGates.
// Returns nil if input is nil.
func convertQualityGates(gates *protocol.QualityGates) *QualityGates {
	if gates == nil {
		return nil
	}

	apiGates := make([]QualityGate, 0, len(gates.Gates))
	for _, g := range gates.Gates {
		apiGates = append(apiGates, QualityGate{
			Type:        g.Type,
			Command:     g.Command,
			Required:    g.Required,
			Description: g.Description,
		})
	}

	return &QualityGates{
		Level: gates.Level,
		Gates: apiGates,
	}
}

// convertPostMergeChecklist converts protocol.PostMergeChecklist to api.PostMergeChecklist.
// Returns nil if input is nil.
func convertPostMergeChecklist(pmc *protocol.PostMergeChecklist) *PostMergeChecklist {
	if pmc == nil {
		return nil
	}

	apiGroups := make([]ChecklistGroup, 0, len(pmc.Groups))
	for _, group := range pmc.Groups {
		apiItems := make([]ChecklistItem, 0, len(group.Items))
		for _, item := range group.Items {
			apiItems = append(apiItems, ChecklistItem{
				Description: item.Description,
				Command:     item.Command,
			})
		}
		apiGroups = append(apiGroups, ChecklistGroup{
			Title: group.Title,
			Items: apiItems,
		})
	}

	return &PostMergeChecklist{
		Groups: apiGroups,
	}
}

// convertKnownIssues converts []protocol.KnownIssue to []api.KnownIssue.
// Returns empty slice if input is nil or empty.
func convertKnownIssues(issues []protocol.KnownIssue) []KnownIssue {
	if len(issues) == 0 {
		return []KnownIssue{}
	}

	apiIssues := make([]KnownIssue, 0, len(issues))
	for _, issue := range issues {
		apiIssues = append(apiIssues, KnownIssue{
			Title:       issue.Title,
			Description: issue.Description,
			Status:      issue.Status,
			Workaround:  issue.Workaround,
		})
	}

	return apiIssues
}

// formatStubReports converts persisted stub scan results into a markdown string
// for the StubReportPanel. Returns empty string if no reports exist.
func formatStubReports(reports map[string]*protocol.ScanStubsData) string {
	if len(reports) == 0 {
		return ""
	}

	var buf strings.Builder
	totalHits := 0
	for _, r := range reports {
		if r != nil {
			totalHits += len(r.Hits)
		}
	}

	if totalHits == 0 {
		buf.WriteString("No stubs detected — all agent-changed files are clean.\n")
		return buf.String()
	}

	// Sort wave keys for deterministic output
	keys := make([]string, 0, len(reports))
	for k := range reports {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, waveKey := range keys {
		r := reports[waveKey]
		if r == nil || len(r.Hits) == 0 {
			continue
		}
		buf.WriteString(fmt.Sprintf("### %s — %d stub%s\n\n", waveKey, len(r.Hits), pluralS(len(r.Hits))))
		buf.WriteString("| File | Line | Pattern | Context |\n")
		buf.WriteString("|------|------|---------|---------|\n")
		for _, hit := range r.Hits {
			ctx := strings.ReplaceAll(hit.Context, "|", "\\|")
			buf.WriteString(fmt.Sprintf("| `%s` | %d | %s | %s |\n", hit.File, hit.Line, hit.Pattern, ctx))
		}
		buf.WriteString("\n")
	}

	return buf.String()
}

func pluralS(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// handleDeleteImpl handles DELETE /api/impl/{slug}.
// Delegates to service.DeleteImpl and returns 204 on success.
func (s *Server) handleDeleteImpl(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		http.Error(w, "missing slug", http.StatusBadRequest)
		return
	}

	deps := s.makeDeps()
	if err := service.DeleteImpl(deps, slug); err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	s.InvalidateImplCache()
	w.WriteHeader(http.StatusNoContent)
}

// handleArchiveImpl handles POST /api/impl/{slug}/archive.
// Delegates to service.ArchiveImpl and returns 200 on success.
func (s *Server) handleArchiveImpl(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		http.Error(w, "missing slug", http.StatusBadRequest)
		return
	}

	deps := s.makeDeps()
	if err := service.ArchiveImpl(deps, slug); err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.Error(w, err.Error(), http.StatusNotFound)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	s.InvalidateImplCache()
	s.globalBroker.broadcast("impl_list_updated")
	w.WriteHeader(http.StatusOK)
}

// allScaffoldsCommitted returns true when every scaffold file has status "committed".
func allScaffoldsCommitted(scaffolds []protocol.ScaffoldFile) bool {
	if len(scaffolds) == 0 {
		return false
	}
	for _, sf := range scaffolds {
		if !strings.HasPrefix(sf.Status, "committed") {
			return false
		}
	}
	return true
}

// RegisterCriticRoutes registers the critic-review HTTP route.
// Called from server.go after the other impl routes are registered.
func (s *Server) RegisterCriticRoutes() {
	s.mux.HandleFunc("GET /api/impl/{slug}/critic-review", s.handleGetCriticReview)
	s.mux.HandleFunc("POST /api/impl/{slug}/run-critic", s.handleRunCriticReview)
	s.mux.HandleFunc("PATCH /api/impl/{slug}/fix-critic", s.handleFixCritic)
	s.mux.HandleFunc("POST /api/impl/{slug}/auto-fix-critic", s.handleAutoFixCritic)
}
