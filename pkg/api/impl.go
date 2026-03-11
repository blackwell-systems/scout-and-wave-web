package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	engine "github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	etypes "github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

// completionStatusRe matches a real agent-written status line (not the template placeholder).
// Template: "status: complete | partial | blocked"
// Real:     "status: complete" or "status: partial" or "status: blocked"
var completionStatusRe = regexp.MustCompile(`(?m)^status: (complete|partial|blocked)$`)

// waveHeaderRe matches top-level wave section headers (## Wave N).
var waveHeaderRe = regexp.MustCompile(`(?m)^## Wave \d+\b`)

// agentSectionRe matches per-agent section headers (### Wave N Agent X or ### Agent X).
var agentSectionRe = regexp.MustCompile(`(?m)^### (?:Wave \d+ )?Agent [A-Z]\b`)

// implListEntry is one item in the GET /api/impl response.
type implListEntry struct {
	Slug         string   `json:"slug"`
	Repo         string   `json:"repo"`           // repo name (from saw.config.json) this IMPL belongs to
	RepoPath     string   `json:"repo_path"`      // absolute path to the repo
	DocStatus    string   `json:"doc_status"`     // "active" or "complete"
	WaveCount    int      `json:"wave_count"`     // number of waves (0 if not yet planned)
	AgentCount   int      `json:"agent_count"`    // total agents across all waves
	IsMultiRepo  bool     `json:"is_multi_repo"`  // true when file ownership spans 2+ repos
	InvolvedRepos []string `json:"involved_repos"` // list of repo names from file ownership (for multirepo IMPLs)
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
			if strings.HasPrefix(name, "IMPL-") && (strings.HasSuffix(name, ".md") || strings.HasSuffix(name, ".yaml")) {
				var slug string
				if strings.HasSuffix(name, ".yaml") {
					slug = strings.TrimSuffix(strings.TrimPrefix(name, "IMPL-"), ".yaml")
				} else {
					slug = strings.TrimSuffix(strings.TrimPrefix(name, "IMPL-"), ".md")
				}
				status := "active"
				var waveCount, agentCount int
				var isMultiRepo bool

				fullPath := filepath.Join(implDir, name)
				var involvedRepos []string
				if strings.HasSuffix(name, ".yaml") {
					if m, err := protocol.Load(fullPath); err == nil {
						for _, w := range m.Waves {
							waveCount++
							agentCount += len(w.Agents)
						}
						if m.State == protocol.StateComplete {
							status = "complete"
						}
						repoSet := make(map[string]struct{})
						for _, fo := range m.FileOwnership {
							if fo.Repo != "" && fo.Repo != "system" {
								repoSet[fo.Repo] = struct{}{}
							}
						}
						isMultiRepo = len(repoSet) >= 2
						if isMultiRepo {
							for repoName := range repoSet {
								involvedRepos = append(involvedRepos, repoName)
							}
							sort.Strings(involvedRepos)
						}
					}
				} else {
					// Quick scan: explicit SAW:COMPLETE tag, or infer from completion reports.
					if data, err := os.ReadFile(fullPath); err == nil {
						text := string(data)
						if strings.Contains(text, "SAW:COMPLETE") {
							status = "complete"
						} else if inferComplete(text) {
							status = "complete"
						}
						waveCount = len(waveHeaderRe.FindAllString(text, -1))
						agentCount = len(agentSectionRe.FindAllString(text, -1))
						// Detect multi-repo from file ownership table Repo column
						if doc, err := engine.ParseIMPLDoc(fullPath); err == nil {
							repoSet := make(map[string]struct{})
							for _, info := range doc.FileOwnership {
								if info.Repo != "" && info.Repo != "system" {
									repoSet[info.Repo] = struct{}{}
								}
							}
							isMultiRepo = len(repoSet) >= 2
							if isMultiRepo {
								for repoName := range repoSet {
									involvedRepos = append(involvedRepos, repoName)
								}
								sort.Strings(involvedRepos)
							}
						}
					}
				}

				repoName := repo.Name
				if repoName == "" {
					repoName = filepath.Base(repo.Path)
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

// handleGetImpl serves GET /api/impl/{slug}.
// Searches all configured repos for the IMPL doc. Returns IMPLDocResponse as JSON.
// 404 if the file does not exist in any repo; 500 on parse error.
func (s *Server) handleGetImpl(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

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

	// Search all repos for the IMPL doc (both active and complete directories)
	var implPath string
	for _, repo := range repos {
		implDirs := []string{
			filepath.Join(repo.Path, "docs", "IMPL"),
			filepath.Join(repo.Path, "docs", "IMPL", "complete"),
		}

		for _, implDir := range implDirs {
			yamlPath := filepath.Join(implDir, "IMPL-"+slug+".yaml")
			mdPath := filepath.Join(implDir, "IMPL-"+slug+".md")

			if _, err := os.Stat(yamlPath); err == nil {
				implPath = yamlPath
				break
			}
			if _, err := os.Stat(mdPath); err == nil {
				implPath = mdPath
				break
			}
		}
		if implPath != "" {
			break
		}
	}

	if implPath == "" {
		http.Error(w, "IMPL doc not found", http.StatusNotFound)
		return
	}

	// YAML manifests (Scout v0.6.0+) are loaded via protocol.Load; markdown
	// docs use the legacy line-by-line parser.
	var resp IMPLDocResponse
	if strings.HasSuffix(implPath, ".yaml") || strings.HasSuffix(implPath, ".yml") {
		manifest, err := protocol.Load(implPath)
		if err != nil {
			if os.IsNotExist(err) {
				http.Error(w, "IMPL doc not found", http.StatusNotFound)
				return
			}
			http.Error(w, "failed to load IMPL manifest", http.StatusInternalServerError)
			return
		}
		resp = implDocResponseFromManifest(slug, manifest)
	} else {
		doc, err := engine.ParseIMPLDoc(implPath)
		if err != nil {
			if isNotExistErr(err) {
				http.Error(w, "IMPL doc not found", http.StatusNotFound)
				return
			}
			http.Error(w, "failed to parse IMPL doc", http.StatusInternalServerError)
			return
		}
		docStatus := "active"
		if doc.DocStatus == "COMPLETE" {
			docStatus = "complete"
		}
		scaffoldFiles := []string{}
		for file, info := range doc.FileOwnership {
			if strings.ToLower(info.Agent) == "scaffold" {
				scaffoldFiles = append(scaffoldFiles, file)
			}
		}
		resp = IMPLDocResponse{
			Slug:        slug,
			DocStatus:   docStatus,
			CompletedAt: doc.CompletedAt,
			Suitability: SuitabilityInfo{
				Verdict:   suitabilityVerdict(doc.Status),
				Rationale: "",
			},
			FileOwnership:         mapFileOwnership(doc.FileOwnership),
			FileOwnershipCol4Name: doc.FileOwnershipCol4,
			Waves:                 mapWaves(doc.Waves),
			Scaffold: ScaffoldInfo{
				Required:  len(scaffoldFiles) > 0,
				Files:     scaffoldFiles,
				Contracts: []ContractEntry{},
			},
			PreMortem:              mapPreMortem(doc.PreMortem),
			KnownIssues:            mapKnownIssues(doc.KnownIssues),
			ScaffoldsDetail:        mapScaffoldsDetail(doc.ScaffoldsDetail),
			InterfaceContractsText: doc.InterfaceContractsText,
			DependencyGraphText:    injectScaffoldWave(doc.DependencyGraphText, len(scaffoldFiles) > 0),
			PostMergeChecklistText: doc.PostMergeChecklistText,
			StubReportText:         doc.StubReportText,
			AgentPrompts:           extractAgentPrompts(doc.Waves),
		}
	}

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

// inferComplete returns true if all real agent completion reports in the raw
// IMPL doc text show "status: complete". A "real" report has exactly one of
// injectScaffoldWave prepends a "Wave 0 (scaffold)" section to the dep graph
// text if scaffolds exist and the text doesn't already contain one. Also patches
// "Wave 1 (parallel)" to "Wave 1 (depends on Wave 0)" so the parser draws edges.
func injectScaffoldWave(text string, hasScaffolds bool) string {
	if !hasScaffolds || strings.Contains(text, "Wave 0") {
		return text
	}
	scaffold := "Wave 0 (scaffold)\n  [Scaffold] shared type definitions\n"
	// Insert after opening code fence if present, otherwise prepend
	if idx := strings.Index(text, "```\n"); idx >= 0 {
		return text[:idx+4] + scaffold + text[idx+4:]
	}
	return scaffold + text
}

// complete/partial/blocked on its own line (not the template placeholder
// "status: complete | partial | blocked"). Returns false if no real reports
// are found or any report shows partial/blocked.
func inferComplete(text string) bool {
	matches := completionStatusRe.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return false
	}
	for _, m := range matches {
		if m[1] != "complete" {
			return false
		}
	}
	return true
}

// isNotExistErr unwraps errors to check for os.ErrNotExist by checking
// both direct and wrapped forms.
func isNotExistErr(err error) bool {
	if err == nil {
		return false
	}
	if os.IsNotExist(err) {
		return true
	}
	// ParseIMPLDoc wraps errors; check if underlying error is not-exist.
	// Walk the error chain via errors.As alternative: check string heuristic.
	// Since os.Open is the only source and ParseIMPLDoc wraps with %w, unwrap.
	type unwrapper interface{ Unwrap() error }
	for err != nil {
		if os.IsNotExist(err) {
			return true
		}
		u, ok := err.(unwrapper)
		if !ok {
			break
		}
		err = u.Unwrap()
	}
	return false
}

// suitabilityVerdict maps the parsed status string to a verdict.
// Defaults to "UNKNOWN" if empty.
func suitabilityVerdict(status string) string {
	if status == "" {
		return "UNKNOWN"
	}
	return status
}

// mapFileOwnership converts the file->FileOwnershipInfo map to []FileOwnershipEntry.
func mapFileOwnership(ownership map[string]etypes.FileOwnershipInfo) []FileOwnershipEntry {
	entries := make([]FileOwnershipEntry, 0, len(ownership))
	for file, info := range ownership {
		entries = append(entries, FileOwnershipEntry{
			File:      file,
			Agent:     info.Agent,
			Wave:      info.Wave,
			Action:    info.Action,
			DependsOn: info.DependsOn,
			Repo:      info.Repo,
		})
	}
	return entries
}

// mapWaves converts []etypes.Wave to []WaveInfo.
func mapWaves(waves []etypes.Wave) []WaveInfo {
	result := make([]WaveInfo, 0, len(waves))
	for _, w := range waves {
		agents := make([]string, 0, len(w.Agents))
		for _, a := range w.Agents {
			agents = append(agents, a.Letter)
		}
		result = append(result, WaveInfo{
			Number:       w.Number,
			Agents:       agents,
			Dependencies: []int{},
		})
	}
	return result
}

// implDocResponseFromManifest maps a YAML *protocol.IMPLManifest to IMPLDocResponse.
// Used by handleGetImpl for .yaml IMPL docs (Scout v0.6.0+).
func implDocResponseFromManifest(slug string, m *protocol.IMPLManifest) IMPLDocResponse {
	docStatus := "active"
	if m.State == protocol.StateComplete {
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
		waveInfos = append(waveInfos, WaveInfo{
			Number:       w.Number,
			Agents:       agents,
			Dependencies: []int{},
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
			Files:     scaffoldFiles,
			Contracts: []ContractEntry{},
		},
		PreMortem:              preMortem,
		KnownIssues:            knownIssues,
		ScaffoldsDetail:        scaffoldDetail,
		InterfaceContractsText: contractsBuf.String(),
		DependencyGraphText:    depGraphBuf.String(),
		AgentPrompts:           agentPrompts,
		QualityGates:           convertQualityGates(m.QualityGates),
		PostMergeChecklist:     convertPostMergeChecklist(m.PostMergeChecklist),
		KnownIssuesStructured:  convertKnownIssues(m.KnownIssues),
	}
}

// mapKnownIssues converts []etypes.KnownIssue to []KnownIssueEntry.
func mapKnownIssues(issues []etypes.KnownIssue) []KnownIssueEntry {
	if issues == nil {
		return []KnownIssueEntry{}
	}
	result := make([]KnownIssueEntry, 0, len(issues))
	for _, issue := range issues {
		result = append(result, KnownIssueEntry{
			Description: issue.Description,
			Status:      issue.Status,
			Workaround:  issue.Workaround,
		})
	}
	return result
}

// mapScaffoldsDetail converts []etypes.ScaffoldFile to []ScaffoldFileEntry.
func mapScaffoldsDetail(scaffolds []etypes.ScaffoldFile) []ScaffoldFileEntry {
	if scaffolds == nil {
		return []ScaffoldFileEntry{}
	}
	result := make([]ScaffoldFileEntry, 0, len(scaffolds))
	for _, scaffold := range scaffolds {
		result = append(result, ScaffoldFileEntry{
			FilePath:   scaffold.FilePath,
			Contents:   scaffold.Contents,
			ImportPath: scaffold.ImportPath,
		})
	}
	return result
}

// extractAgentPrompts flattens agent prompts from all waves into a single list.
func extractAgentPrompts(waves []etypes.Wave) []AgentPromptEntry {
	result := []AgentPromptEntry{}
	for _, wave := range waves {
		for _, agent := range wave.Agents {
			result = append(result, AgentPromptEntry{
				Wave:   wave.Number,
				Agent:  agent.Letter,
				Prompt: agent.Prompt,
			})
		}
	}
	if result == nil {
		return []AgentPromptEntry{}
	}
	return result
}

// mapPreMortem converts a *etypes.PreMortem to *PreMortemEntry for the API response.
func mapPreMortem(pm *etypes.PreMortem) *PreMortemEntry {
	if pm == nil {
		return nil
	}
	rows := make([]PreMortemRowEntry, 0, len(pm.Rows))
	for _, r := range pm.Rows {
		rows = append(rows, PreMortemRowEntry{
			Scenario:   r.Scenario,
			Likelihood: r.Likelihood,
			Impact:     r.Impact,
			Mitigation: r.Mitigation,
		})
	}
	return &PreMortemEntry{
		OverallRisk: pm.OverallRisk,
		Rows:        rows,
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
		mdPath := filepath.Join(dir, "IMPL-"+slug+".md")

		if _, err := os.Stat(yamlPath); err == nil {
			implPath = yamlPath
			break
		}
		if _, err := os.Stat(mdPath); err == nil {
			implPath = mdPath
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
	for _, ext := range []string{".yaml", ".md"} {
		candidate := filepath.Join(activeDir, "IMPL-"+slug+ext)
		if _, err := os.Stat(candidate); err == nil {
			sourcePath = candidate
			break
		}
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
