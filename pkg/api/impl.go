package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

// completionStatusRe matches a real agent-written status line (not the template placeholder).
// Template: "status: complete | partial | blocked"
// Real:     "status: complete" or "status: partial" or "status: blocked"
var completionStatusRe = regexp.MustCompile(`(?m)^status: (complete|partial|blocked)$`)

// implListEntry is one item in the GET /api/impl response.
type implListEntry struct {
	Slug      string `json:"slug"`
	DocStatus string `json:"doc_status"` // "active" or "complete"
}

// handleListImpls serves GET /api/impl and returns a JSON array of impl entries.
func (s *Server) handleListImpls(w http.ResponseWriter, r *http.Request) {
	entries, err := os.ReadDir(s.cfg.IMPLDir)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]implListEntry{})
		return
	}
	var result []implListEntry
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, "IMPL-") && strings.HasSuffix(name, ".md") {
			slug := strings.TrimSuffix(strings.TrimPrefix(name, "IMPL-"), ".md")
			status := "active"
			// Quick scan: explicit SAW:COMPLETE tag, or infer from completion reports.
			if data, err := os.ReadFile(filepath.Join(s.cfg.IMPLDir, name)); err == nil {
				text := string(data)
				if strings.Contains(text, "SAW:COMPLETE") {
					status = "complete"
				} else if inferComplete(text) {
					status = "complete"
				}
			}
			result = append(result, implListEntry{Slug: slug, DocStatus: status})
		}
	}
	if result == nil {
		result = []implListEntry{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// handleGetImpl serves GET /api/impl/{slug}.
// It locates the IMPL doc file at cfg.IMPLDir/IMPL-{slug}.md, parses it
// via protocol.ParseIMPLDoc, and returns IMPLDocResponse as JSON.
// 404 if the file does not exist; 500 on parse error.
func (s *Server) handleGetImpl(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".md")

	doc, err := protocol.ParseIMPLDoc(implPath)
	if err != nil {
		if isNotExistErr(err) {
			http.Error(w, "IMPL doc not found", http.StatusNotFound)
			return
		}
		http.Error(w, "failed to parse IMPL doc", http.StatusInternalServerError)
		return
	}

	// Map types.IMPLDoc -> IMPLDocResponse
	docStatus := "active"
	if doc.DocStatus == "COMPLETE" {
		docStatus = "complete"
	}
	// Detect scaffold files from file ownership table
	scaffoldFiles := []string{}
	for file, info := range doc.FileOwnership {
		if strings.ToLower(info.Agent) == "scaffold" {
			scaffoldFiles = append(scaffoldFiles, file)
		}
	}

	resp := IMPLDocResponse{
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
			Contracts: []ContractEntry{}, // Contracts not parsed yet - would need scaffolds section parsing
		},
		PreMortem: mapPreMortem(doc.PreMortem),
		KnownIssues:            mapKnownIssues(doc.KnownIssues),
		ScaffoldsDetail:        mapScaffoldsDetail(doc.ScaffoldsDetail),
		InterfaceContractsText: doc.InterfaceContractsText,
		DependencyGraphText:    doc.DependencyGraphText,
		PostMergeChecklistText: doc.PostMergeChecklistText,
		AgentPrompts:           extractAgentPrompts(doc.Waves),
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
	w.WriteHeader(http.StatusAccepted)
}

// handleReject serves POST /api/impl/{slug}/reject.
// Publishes a server-sent event to the slug's SSE broker and returns 202.
func (s *Server) handleReject(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	s.broker.Publish(slug, SSEEvent{Event: "plan_rejected", Data: map[string]string{"slug": slug}})
	w.WriteHeader(http.StatusAccepted)
}

// inferComplete returns true if all real agent completion reports in the raw
// IMPL doc text show "status: complete". A "real" report has exactly one of
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
func mapFileOwnership(ownership map[string]types.FileOwnershipInfo) []FileOwnershipEntry {
	entries := make([]FileOwnershipEntry, 0, len(ownership))
	for file, info := range ownership {
		entries = append(entries, FileOwnershipEntry{
			File:      file,
			Agent:     info.Agent,
			Wave:      info.Wave,
			Action:    info.Action,
			DependsOn: info.DependsOn,
		})
	}
	return entries
}

// mapWaves converts []types.Wave to []WaveInfo.
func mapWaves(waves []types.Wave) []WaveInfo {
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

// mapKnownIssues converts []types.KnownIssue to []KnownIssueEntry.
func mapKnownIssues(issues []types.KnownIssue) []KnownIssueEntry {
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

// mapScaffoldsDetail converts []types.ScaffoldFile to []ScaffoldFileEntry.
func mapScaffoldsDetail(scaffolds []types.ScaffoldFile) []ScaffoldFileEntry {
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
func extractAgentPrompts(waves []types.Wave) []AgentPromptEntry {
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

// mapPreMortem converts a *types.PreMortem to *PreMortemEntry for the API response.
func mapPreMortem(pm *types.PreMortem) *PreMortemEntry {
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
