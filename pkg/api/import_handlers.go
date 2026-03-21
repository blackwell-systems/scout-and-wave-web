package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"gopkg.in/yaml.v3"
)

// ImportIMPLsRequest is the JSON request body for POST /api/impl/import.
// It instructs the server to import one or more IMPL docs into a PROGRAM manifest.
type ImportIMPLsRequest struct {
	ProgramSlug string         `json:"program_slug"`
	IMPLPaths   []string       `json:"impl_paths"`
	TierMap     map[string]int `json:"tier_map"` // slug -> tier number
	Discover    bool           `json:"discover,omitempty"`
	RepoDir     string         `json:"repo_dir,omitempty"`
}

// ImportIMPLsResponse is the JSON response for POST /api/impl/import.
type ImportIMPLsResponse struct {
	ProgramPath string   `json:"program_path"`
	Imported    []string `json:"imported"` // slugs imported
	Skipped     []string `json:"skipped"`  // slugs skipped (already present)
}

// handleImportIMPLs handles POST /api/impl/import.
// Imports one or more IMPL docs into a PROGRAM manifest. Creates the manifest if
// it does not yet exist. If Discover is true, scans the repo dir for IMPL docs
// and adds any not already present. Returns the manifest path, imported slugs,
// and skipped slugs (already present in the manifest).
func (s *Server) handleImportIMPLs(w http.ResponseWriter, r *http.Request) {
	var req ImportIMPLsRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	if req.ProgramSlug == "" {
		respondError(w, "program_slug is required", http.StatusBadRequest)
		return
	}

	// Resolve repo dir: use request value or fall back to server default.
	repoDir := req.RepoDir
	if repoDir == "" {
		repoDir = s.cfg.RepoPath
	}

	// Discover impl paths from repo if requested.
	if req.Discover {
		discovered := discoverIMPLPaths(repoDir)
		req.IMPLPaths = appendUnique(req.IMPLPaths, discovered)
	}

	if len(req.IMPLPaths) == 0 {
		respondError(w, "impl_paths is required (or use discover:true)", http.StatusBadRequest)
		return
	}

	// Determine PROGRAM manifest path: docs/PROGRAM-{slug}.yaml inside repo dir.
	programPath := filepath.Join(repoDir, "docs", "PROGRAM-"+req.ProgramSlug+".yaml")

	// Load or initialize the PROGRAM manifest.
	var manifest protocol.PROGRAMManifest
	if _, err := os.Stat(programPath); err == nil {
		existing, parseErr := protocol.ParseProgramManifest(programPath)
		if parseErr != nil {
			respondError(w, "failed to parse existing PROGRAM manifest: "+parseErr.Error(), http.StatusInternalServerError)
			return
		}
		manifest = *existing
	} else {
		manifest = protocol.PROGRAMManifest{
			ProgramSlug: req.ProgramSlug,
			Title:       req.ProgramSlug,
			State:       protocol.ProgramStatePlanning,
			Impls:       []protocol.ProgramIMPL{},
			Tiers:       []protocol.ProgramTier{},
		}
	}

	// Build a set of existing slugs so we can detect skips.
	existingSlugs := make(map[string]bool, len(manifest.Impls))
	for _, pi := range manifest.Impls {
		existingSlugs[pi.Slug] = true
	}

	var imported []string
	var skipped []string

	for _, implPath := range req.IMPLPaths {
		slug := slugFromIMPLPath(implPath)

		if existingSlugs[slug] {
			skipped = append(skipped, slug)
			continue
		}

		// Load the IMPL manifest to get its title and agent/wave counts.
		var title string
		var agentCount, waveCount int
		if m, err := protocol.Load(implPath); err == nil {
			title = m.Title
			waveCount = len(m.Waves)
			for _, w := range m.Waves {
				agentCount += len(w.Agents)
			}
		}
		if title == "" {
			title = slug
		}

		tier := 1
		if req.TierMap != nil {
			if t, ok := req.TierMap[slug]; ok {
				tier = t
			}
		}

		pi := protocol.ProgramIMPL{
			Slug:            slug,
			Title:           title,
			Tier:            tier,
			Status:          "pending",
			EstimatedAgents: agentCount,
			EstimatedWaves:  waveCount,
		}
		manifest.Impls = append(manifest.Impls, pi)
		existingSlugs[slug] = true
		imported = append(imported, slug)
	}

	// Rebuild Tiers from current impl assignments.
	manifest.Tiers = buildTiers(manifest.Impls)

	// Update Completion totals.
	manifest.Completion = buildCompletion(manifest.Impls)

	// Marshal and write manifest to disk.
	if err := saveProgramManifest(programPath, &manifest); err != nil {
		respondError(w, "failed to write PROGRAM manifest: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Normalise nil slices to empty slices for clean JSON output.
	if imported == nil {
		imported = []string{}
	}
	if skipped == nil {
		skipped = []string{}
	}

	s.globalBroker.broadcast("program_list_updated")

	respondJSON(w, http.StatusOK, ImportIMPLsResponse{
		ProgramPath: programPath,
		Imported:    imported,
		Skipped:     skipped,
	})
}

// saveProgramManifest marshals manifest to YAML and writes it to path.
// Uses gopkg.in/yaml.v3 directly because protocol.SaveProgramManifest does not exist.
func saveProgramManifest(path string, manifest *protocol.PROGRAMManifest) error {
	data, err := yaml.Marshal(manifest)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// discoverIMPLPaths scans docs/IMPL/ and docs/IMPL/complete/ inside repoDir and
// returns the absolute path for every IMPL-*.yaml file found.
func discoverIMPLPaths(repoDir string) []string {
	dirs := []string{
		filepath.Join(repoDir, "docs", "IMPL"),
		filepath.Join(repoDir, "docs", "IMPL", "complete"),
	}

	var paths []string
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			name := e.Name()
			if strings.HasPrefix(name, "IMPL-") && strings.HasSuffix(name, ".yaml") {
				paths = append(paths, filepath.Join(dir, name))
			}
		}
	}
	return paths
}

// slugFromIMPLPath extracts the feature slug from an IMPL path.
// e.g. "/repo/docs/IMPL/IMPL-my-feature.yaml" -> "my-feature"
func slugFromIMPLPath(path string) string {
	base := filepath.Base(path)
	slug := strings.TrimPrefix(base, "IMPL-")
	slug = strings.TrimSuffix(slug, ".yaml")
	return slug
}

// appendUnique appends elements from src to dst, deduplicating by value.
func appendUnique(dst, src []string) []string {
	seen := make(map[string]bool, len(dst))
	for _, v := range dst {
		seen[v] = true
	}
	for _, v := range src {
		if !seen[v] {
			dst = append(dst, v)
			seen[v] = true
		}
	}
	return dst
}

// buildTiers recomputes ProgramTier entries from the current ProgramIMPL list.
// Groups impls by their Tier field and returns a sorted tier slice.
func buildTiers(impls []protocol.ProgramIMPL) []protocol.ProgramTier {
	tierMap := make(map[int][]string)
	for _, pi := range impls {
		tierMap[pi.Tier] = append(tierMap[pi.Tier], pi.Slug)
	}

	// Sort tier numbers for stable output.
	numbers := make([]int, 0, len(tierMap))
	for n := range tierMap {
		numbers = append(numbers, n)
	}
	sortInts(numbers)

	tiers := make([]protocol.ProgramTier, 0, len(numbers))
	for _, n := range numbers {
		tiers = append(tiers, protocol.ProgramTier{
			Number: n,
			Impls:  tierMap[n],
		})
	}
	return tiers
}

// buildCompletion recomputes ProgramCompletion totals from the current impl list.
func buildCompletion(impls []protocol.ProgramIMPL) protocol.ProgramCompletion {
	var totalAgents, totalWaves, complete int
	tierSet := make(map[int]bool)
	for _, pi := range impls {
		totalAgents += pi.EstimatedAgents
		totalWaves += pi.EstimatedWaves
		tierSet[pi.Tier] = true
		if pi.Status == "complete" {
			complete++
		}
	}
	return protocol.ProgramCompletion{
		ImplsTotal:    len(impls),
		ImplsComplete: complete,
		TiersTotal:    len(tierSet),
		TotalAgents:   totalAgents,
		TotalWaves:    totalWaves,
	}
}

// sortInts sorts a slice of ints in ascending order without importing sort.
func sortInts(s []int) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}
