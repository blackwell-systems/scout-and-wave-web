package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

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
// Scans all repos from saw.config.json (or falls back to startup IMPLDir if no config).
func (s *Server) handleListImpls(w http.ResponseWriter, r *http.Request) {
	// Read saw.config.json to get the list of repos
	configPath := filepath.Join(s.cfg.RepoPath, "saw.config.json")
	configData, err := os.ReadFile(configPath)

	var repos []RepoEntry
	if err == nil {
		var cfg SAWConfig
		if json.Unmarshal(configData, &cfg) == nil && len(cfg.Repos) > 0 {
			repos = cfg.Repos
		}
	}

	// Fallback: if no config or no repos, use the startup IMPLDir
	if len(repos) == 0 {
		repos = []RepoEntry{{
			Name: filepath.Base(s.cfg.RepoPath),
			Path: s.cfg.RepoPath,
		}}
	}

	var result []implListEntry

	// Scan each configured repo's docs/IMPL and docs/IMPL/complete directories
	for _, repo := range repos {
		implDirs := []string{
			filepath.Join(repo.Path, "docs", "IMPL"),
			filepath.Join(repo.Path, "docs", "IMPL", "complete"),
		}

		for _, implDir := range implDirs {
			entries, err := os.ReadDir(implDir)
			if err != nil {
				continue // skip if directory doesn't exist
			}

			for _, e := range entries {
			name := e.Name()
			if strings.HasPrefix(name, "IMPL-") && strings.HasSuffix(name, ".yaml") {
				slug := strings.TrimSuffix(strings.TrimPrefix(name, "IMPL-"), ".yaml")
				// Status is determined by directory location (source of truth after archival)
				status := "active"
				if strings.HasSuffix(implDir, "complete") {
					status = "complete"
				}
				var waveCount, agentCount int
				var isMultiRepo bool

				fullPath := filepath.Join(implDir, name)
				var involvedRepos []string
				if m, err := protocol.Load(fullPath); err == nil {
					for _, w := range m.Waves {
						waveCount++
						agentCount += len(w.Agents)
					}
					repoSet := make(map[string]struct{})
					hasEmptyRepo := false
					for _, fo := range m.FileOwnership {
						if fo.Repo != "" && fo.Repo != "system" {
							repoSet[fo.Repo] = struct{}{}
						} else if fo.Repo == "" {
							hasEmptyRepo = true
						}
					}
					// If some entries have repo: and some don't, the empty ones
					// are implicitly the host repo — that's a second distinct repo.
					if hasEmptyRepo && len(repoSet) > 0 {
						repoSet[repo.Name] = struct{}{}
					}
					isMultiRepo = len(repoSet) >= 2
					if isMultiRepo {
						for repoName := range repoSet {
							involvedRepos = append(involvedRepos, repoName)
						}
						sort.Strings(involvedRepos)
					}
				}

				repoName := repo.Name
				if repoName == "" {
					repoName = filepath.Base(repo.Path)
				}

				// Check if any execution is in progress for this slug
				_, waveActive := s.activeRuns.Load(slug)
				_, merging := s.mergingRuns.Load(slug)
				_, testing := s.testingRuns.Load(slug)
				isExecuting := waveActive || merging || testing
				// Also check scoutRuns (keyed by runID, not slug) — scan for slug prefix
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
					Slug:          slug,
					Repo:          repoName,
					RepoPath:      repo.Path,
					DocStatus:     status,
					WaveCount:     waveCount,
					AgentCount:    agentCount,
					IsMultiRepo:   isMultiRepo,
					InvolvedRepos: involvedRepos,
					IsExecuting:   isExecuting,
				})
			}
		}
		}
	}

	if result == nil {
		result = []implListEntry{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// findImplPath searches all configured repos for an IMPL doc by slug.
// Returns the absolute file path and matched repo, or empty string if not found.
func (s *Server) findImplPath(slug string) (string, RepoEntry) {
	configPath := filepath.Join(s.cfg.RepoPath, "saw.config.json")
	configData, err := os.ReadFile(configPath)

	var repos []RepoEntry
	if err == nil {
		var cfg SAWConfig
		if json.Unmarshal(configData, &cfg) == nil && len(cfg.Repos) > 0 {
			repos = cfg.Repos
		}
	}
	if len(repos) == 0 {
		repos = []RepoEntry{{
			Name: filepath.Base(s.cfg.RepoPath),
			Path: s.cfg.RepoPath,
		}}
	}

	for _, repo := range repos {
		for _, sub := range []string{"docs/IMPL", "docs/IMPL/complete"} {
			candidate := filepath.Join(repo.Path, sub, "IMPL-"+slug+".yaml")
			if _, err := os.Stat(candidate); err == nil {
				return candidate, repo
			}
		}
	}
	return "", RepoEntry{}
}

// handleGetImpl serves GET /api/impl/{slug}.
// Searches all configured repos for the IMPL doc. Returns IMPLDocResponse as JSON.
// 404 if the file does not exist in any repo; 500 on parse error.
func (s *Server) handleGetImpl(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	implPath, matchedRepo := s.findImplPath(slug)
	if implPath == "" {
		http.Error(w, "IMPL doc not found", http.StatusNotFound)
		return
	}

	// Load YAML manifest via protocol.Load
	manifest, err := protocol.Load(implPath)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "IMPL doc not found", http.StatusNotFound)
			return
		}
		http.Error(w, "failed to load IMPL manifest", http.StatusInternalServerError)
		return
	}
	resp := implDocResponseFromManifest(slug, manifest)
	resp.Repo = matchedRepo.Name
	resp.RepoPath = matchedRepo.Path

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		// Headers already written; nothing more we can do.
		return
	}
}

// handleApprove serves POST /api/impl/{slug}/approve.
// Publishes a server-sent event to the slug's SSE broker and returns 202.
func (s *Server) handleApprove(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	s.broker.Publish(slug, SSEEvent{Event: "plan_approved", Data: map[string]string{"slug": slug}})
	s.globalBroker.broadcast("impl_list_updated") // status change visible in sidebar
	w.WriteHeader(http.StatusAccepted)
}

// handleReject serves POST /api/impl/{slug}/reject.
// Publishes a server-sent event to the slug's SSE broker and returns 202.
func (s *Server) handleReject(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	s.broker.Publish(slug, SSEEvent{Event: "plan_rejected", Data: map[string]string{"slug": slug}})
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
		Slug:        slug,
		DocStatus:   docStatus,
		CompletedAt: m.CompletionDate,
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
func formatStubReports(reports map[string]*protocol.ScanStubsResult) string {
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
// Removes the IMPL doc file from disk (searches both active and complete directories).
func (s *Server) handleDeleteImpl(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		http.Error(w, "missing slug", http.StatusBadRequest)
		return
	}

	// Search both active and complete directories
	dirs := []string{
		s.cfg.IMPLDir,
		filepath.Join(s.cfg.IMPLDir, "complete"),
	}

	var implPath string
	for _, dir := range dirs {
		yamlPath := filepath.Join(dir, "IMPL-"+slug+".yaml")

		if _, err := os.Stat(yamlPath); err == nil {
			implPath = yamlPath
			break
		}
	}

	if implPath == "" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	if err := os.Remove(implPath); err != nil {
		http.Error(w, "failed to delete", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleArchiveImpl handles POST /api/impl/{slug}/archive.
// Moves a completed IMPL doc from docs/IMPL/ to docs/IMPL/complete/.
func (s *Server) handleArchiveImpl(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		http.Error(w, "missing slug", http.StatusBadRequest)
		return
	}

	// Find the IMPL in the active directory
	activeDir := s.cfg.IMPLDir
	completeDir := filepath.Join(s.cfg.IMPLDir, "complete")

	var sourcePath string
	candidate := filepath.Join(activeDir, "IMPL-"+slug+".yaml")
	if _, err := os.Stat(candidate); err == nil {
		sourcePath = candidate
	}

	if sourcePath == "" {
		http.Error(w, "IMPL not found in active directory", http.StatusNotFound)
		return
	}

	// Ensure complete directory exists
	if err := os.MkdirAll(completeDir, 0755); err != nil {
		http.Error(w, "failed to create complete directory", http.StatusInternalServerError)
		return
	}

	// Move file
	destPath := filepath.Join(completeDir, filepath.Base(sourcePath))
	if err := os.Rename(sourcePath, destPath); err != nil {
		http.Error(w, "failed to archive IMPL", http.StatusInternalServerError)
		return
	}

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
}
