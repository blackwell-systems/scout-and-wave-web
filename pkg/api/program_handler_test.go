package api

import (
	"github.com/blackwell-systems/scout-and-wave-web/pkg/service"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// TestHandleListPrograms_Empty tests that an empty programs list returns [].
func TestHandleListPrograms_Empty(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a repo with docs/ but no PROGRAM files
	repoDir := filepath.Join(tmpDir, "test-repo")
	docsDir := filepath.Join(repoDir, "docs")
	if err := os.MkdirAll(docsDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Write saw.config.json pointing to this repo
	configPath := filepath.Join(tmpDir, "saw.config.json")
	config := SAWConfig{
		Repos: []RepoEntry{{Name: "test-repo", Path: repoDir}},
	}
	configData, _ := json.Marshal(config)
	if err := os.WriteFile(configPath, configData, 0644); err != nil {
		t.Fatal(err)
	}

	server := &Server{
		cfg: Config{
			RepoPath: tmpDir,
			IMPLDir:  docsDir,
		},
	}

	req := httptest.NewRequest("GET", "/api/programs", nil)
	w := httptest.NewRecorder()

	server.handleListPrograms(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var resp ProgramListResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Programs == nil {
		t.Error("programs should not be nil")
	}

	if len(resp.Programs) != 0 {
		t.Errorf("expected 0 programs, got %d", len(resp.Programs))
	}
}

// TestHandleListPrograms_MetricsAndStandalone tests that GET /api/programs returns
// metrics and standalone fields, and that standalone contains only non-program IMPLs.
func TestHandleListPrograms_MetricsAndStandalone(t *testing.T) {
	tmpDir := t.TempDir()

	repoDir := filepath.Join(tmpDir, "test-repo")
	docsDir := filepath.Join(repoDir, "docs")
	implDir := filepath.Join(docsDir, "IMPL")
	completeDir := filepath.Join(implDir, "complete")
	if err := os.MkdirAll(completeDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a PROGRAM manifest that claims "program-impl"
	programContent := `title: Test Program
program_slug: test-program
state: PLANNING
impls:
  - slug: program-impl
    title: Program Implementation
    tier: 1
    status: pending
tiers:
  - number: 1
    impls:
      - program-impl
    description: First tier
completion:
  tiers_complete: 0
  tiers_total: 1
  impls_complete: 0
  impls_total: 1
  total_agents: 0
  total_waves: 0
`
	if err := os.WriteFile(filepath.Join(docsDir, "PROGRAM-test-program.yaml"), []byte(programContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Create active IMPL files: one linked to program, one standalone
	implLinked := `title: Program Implementation
feature_slug: program-impl
`
	implStandalone := `title: Standalone Feature
feature_slug: standalone-impl
`
	if err := os.WriteFile(filepath.Join(implDir, "IMPL-program-impl.yaml"), []byte(implLinked), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(implDir, "IMPL-standalone-impl.yaml"), []byte(implStandalone), 0644); err != nil {
		t.Fatal(err)
	}

	// Create a completed standalone IMPL
	implComplete := `title: Done Feature
feature_slug: done-impl
`
	if err := os.WriteFile(filepath.Join(completeDir, "IMPL-done-impl.yaml"), []byte(implComplete), 0644); err != nil {
		t.Fatal(err)
	}

	// Write saw.config.json
	configPath := filepath.Join(tmpDir, "saw.config.json")
	config := SAWConfig{
		Repos: []RepoEntry{{Name: "test-repo", Path: repoDir}},
	}
	configData, _ := json.Marshal(config)
	if err := os.WriteFile(configPath, configData, 0644); err != nil {
		t.Fatal(err)
	}

	// Bypass implProgramCache TTL for test
	oldTTL := implProgramCacheTTL
	implProgramCacheTTL = 0
	implProgramCacheInstance = &implProgramCache{ttl: 0}
	defer func() {
		implProgramCacheTTL = oldTTL
		implProgramCacheInstance = &implProgramCache{ttl: oldTTL}
	}()

	server := &Server{
		cfg: Config{
			RepoPath: tmpDir,
			IMPLDir:  docsDir,
		},
	}

	req := httptest.NewRequest("GET", "/api/programs", nil)
	w := httptest.NewRecorder()

	server.handleListPrograms(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp ProgramListResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Verify metrics are present
	if resp.Metrics.CompletedCount != 1 {
		t.Errorf("expected completed_count=1, got %d", resp.Metrics.CompletedCount)
	}

	// Verify standalone only contains non-program IMPLs
	for _, s := range resp.Standalone {
		if s.ProgramSlug != "" {
			t.Errorf("standalone entry %q has program_slug=%q, expected empty", s.Slug, s.ProgramSlug)
		}
	}

	// Verify standalone-impl and done-impl are in standalone
	standaloneSlugs := make(map[string]bool)
	for _, s := range resp.Standalone {
		standaloneSlugs[s.Slug] = true
	}
	if !standaloneSlugs["standalone-impl"] {
		t.Error("expected 'standalone-impl' in standalone list")
	}
	if !standaloneSlugs["done-impl"] {
		t.Error("expected 'done-impl' in standalone list")
	}

	// Verify program-linked IMPL is NOT in standalone
	if standaloneSlugs["program-impl"] {
		t.Error("program-impl should NOT appear in standalone list")
	}
}

// TestHandleListPrograms_StandaloneEmpty tests that standalone is an empty array (not null)
// when all IMPLs belong to programs.
func TestHandleListPrograms_StandaloneEmpty(t *testing.T) {
	tmpDir := t.TempDir()

	repoDir := filepath.Join(tmpDir, "test-repo")
	docsDir := filepath.Join(repoDir, "docs")
	if err := os.MkdirAll(docsDir, 0755); err != nil {
		t.Fatal(err)
	}

	configPath := filepath.Join(tmpDir, "saw.config.json")
	config := SAWConfig{
		Repos: []RepoEntry{{Name: "test-repo", Path: repoDir}},
	}
	configData, _ := json.Marshal(config)
	if err := os.WriteFile(configPath, configData, 0644); err != nil {
		t.Fatal(err)
	}

	server := &Server{
		cfg: Config{
			RepoPath: tmpDir,
			IMPLDir:  docsDir,
		},
	}

	req := httptest.NewRequest("GET", "/api/programs", nil)
	w := httptest.NewRecorder()

	server.handleListPrograms(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var resp ProgramListResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Standalone == nil {
		t.Error("standalone should not be nil in JSON (should be [])")
	}
	if len(resp.Standalone) != 0 {
		t.Errorf("expected 0 standalone entries, got %d", len(resp.Standalone))
	}
}

// TestHandleGetProgramStatus_NotFound tests 404 when PROGRAM doc doesn't exist.
func TestHandleGetProgramStatus_NotFound(t *testing.T) {
	tmpDir := t.TempDir()

	repoDir := filepath.Join(tmpDir, "test-repo")
	docsDir := filepath.Join(repoDir, "docs")
	if err := os.MkdirAll(docsDir, 0755); err != nil {
		t.Fatal(err)
	}

	configPath := filepath.Join(tmpDir, "saw.config.json")
	config := SAWConfig{
		Repos: []RepoEntry{{Name: "test-repo", Path: repoDir}},
	}
	configData, _ := json.Marshal(config)
	if err := os.WriteFile(configPath, configData, 0644); err != nil {
		t.Fatal(err)
	}

	server := &Server{
		cfg: Config{
			RepoPath: tmpDir,
			IMPLDir:  docsDir,
		},
	}

	req := httptest.NewRequest("GET", "/api/program/nonexistent", nil)
	req.SetPathValue("slug", "nonexistent")
	w := httptest.NewRecorder()

	server.handleGetProgramStatus(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

// TestHandleGetProgramStatus_Valid tests successful status retrieval.
func TestHandleGetProgramStatus_Valid(t *testing.T) {
	tmpDir := t.TempDir()

	repoDir := filepath.Join(tmpDir, "test-repo")
	docsDir := filepath.Join(repoDir, "docs")
	if err := os.MkdirAll(docsDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a minimal valid PROGRAM manifest
	programPath := filepath.Join(docsDir, "PROGRAM-test-program.yaml")
	manifest := protocol.PROGRAMManifest{
		Title:       "Test Program",
		ProgramSlug: "test-program",
		State:       protocol.ProgramStatePlanning,
		Impls: []protocol.ProgramIMPL{
			{Slug: "impl-1", Title: "Implementation 1", Tier: 1, Status: "pending"},
		},
		Tiers: []protocol.ProgramTier{
			{Number: 1, Impls: []string{"impl-1"}, Description: "First tier"},
		},
		Completion: protocol.ProgramCompletion{
			TiersComplete: 0,
			TiersTotal:    1,
			ImplsComplete: 0,
			ImplsTotal:    1,
		},
	}
	manifestData, _ := json.Marshal(manifest)
	// Convert to YAML for the parser
	yamlData := strings.ReplaceAll(string(manifestData), ",", "\n")
	yamlData = strings.ReplaceAll(yamlData, "{", "")
	yamlData = strings.ReplaceAll(yamlData, "}", "")
	yamlData = strings.ReplaceAll(yamlData, "[", "")
	yamlData = strings.ReplaceAll(yamlData, "]", "")
	yamlData = strings.ReplaceAll(yamlData, `"`, "")

	// Write a proper YAML format
	yamlContent := `title: Test Program
program_slug: test-program
state: PLANNING
impls:
  - slug: impl-1
    title: Implementation 1
    tier: 1
    status: pending
tiers:
  - number: 1
    impls:
      - impl-1
    description: First tier
completion:
  tiers_complete: 0
  tiers_total: 1
  impls_complete: 0
  impls_total: 1
  total_agents: 0
  total_waves: 0
`
	if err := os.WriteFile(programPath, []byte(yamlContent), 0644); err != nil {
		t.Fatal(err)
	}

	configPath := filepath.Join(tmpDir, "saw.config.json")
	config := SAWConfig{
		Repos: []RepoEntry{{Name: "test-repo", Path: repoDir}},
	}
	configData, _ := json.Marshal(config)
	if err := os.WriteFile(configPath, configData, 0644); err != nil {
		t.Fatal(err)
	}

	server := &Server{
		cfg: Config{
			RepoPath: tmpDir,
			IMPLDir:  docsDir,
		},
	}

	req := httptest.NewRequest("GET", "/api/program/test-program", nil)
	req.SetPathValue("slug", "test-program")
	w := httptest.NewRecorder()

	server.handleGetProgramStatus(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp ProgramStatusResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.ProgramSlug != "test-program" {
		t.Errorf("expected program_slug=test-program, got %s", resp.ProgramSlug)
	}

	if resp.Title != "Test Program" {
		t.Errorf("expected title=Test Program, got %s", resp.Title)
	}

	if resp.State != "PLANNING" {
		t.Errorf("expected state=PLANNING, got %s", resp.State)
	}

	if resp.IsExecuting {
		t.Error("expected is_executing=false")
	}

	if len(resp.TierStatuses) != 1 {
		t.Errorf("expected 1 tier status, got %d", len(resp.TierStatuses))
	}
}

// TestHandleExecuteTier_Conflict tests that concurrent execution returns 409.
func TestHandleExecuteTier_Conflict(t *testing.T) {
	tmpDir := t.TempDir()

	repoDir := filepath.Join(tmpDir, "test-repo")
	docsDir := filepath.Join(repoDir, "docs")
	if err := os.MkdirAll(docsDir, 0755); err != nil {
		t.Fatal(err)
	}

	programPath := filepath.Join(docsDir, "PROGRAM-test-program.yaml")
	yamlContent := `title: Test Program
program_slug: test-program
state: PLANNING
impls:
  - slug: impl-1
    title: Implementation 1
    tier: 1
    status: pending
tiers:
  - number: 1
    impls:
      - impl-1
completion:
  tiers_complete: 0
  tiers_total: 1
  impls_complete: 0
  impls_total: 1
  total_agents: 0
  total_waves: 0
`
	if err := os.WriteFile(programPath, []byte(yamlContent), 0644); err != nil {
		t.Fatal(err)
	}

	configPath := filepath.Join(tmpDir, "saw.config.json")
	config := SAWConfig{
		Repos: []RepoEntry{{Name: "test-repo", Path: repoDir}},
	}
	configData, _ := json.Marshal(config)
	if err := os.WriteFile(configPath, configData, 0644); err != nil {
		t.Fatal(err)
	}

	serverCtx, serverCancel := context.WithCancel(context.Background())
	defer serverCancel()
	server := &Server{
		cfg: Config{
			RepoPath: tmpDir,
			IMPLDir:  docsDir,
		},
		broker:       &sseBroker{clients: make(map[string][]chan SSEEvent)},
		globalBroker: newGlobalBroker(),
		serverCtx:    serverCtx,
		serverCancel: serverCancel,
	}

	// Mark the program as already executing (in service layer)
	service.ProgramRuns.TryStart("test-program")
	defer service.ProgramRuns.Done("test-program")

	req := httptest.NewRequest("POST", "/api/program/test-program/tier/1/execute", nil)
	req.SetPathValue("slug", "test-program")
	req.SetPathValue("n", "1")
	w := httptest.NewRecorder()

	server.handleExecuteTier(w, req)

	if w.Code != http.StatusConflict {
		t.Errorf("expected status 409, got %d", w.Code)
	}
}

// TestHandleReplanProgram_NotFound tests that replan returns 404 when the program slug is unknown.
func TestHandleReplanProgram_NotFound(t *testing.T) {
	tmpDir := t.TempDir()

	serverCtx, serverCancel := context.WithCancel(context.Background())
	defer serverCancel()
	server := &Server{
		cfg:          Config{RepoPath: tmpDir},
		serverCtx:    serverCtx,
		serverCancel: serverCancel,
	}

	req := httptest.NewRequest("POST", "/api/program/nonexistent/replan", nil)
	req.SetPathValue("slug", "nonexistent")
	w := httptest.NewRecorder()

	server.handleReplanProgram(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}
}

// TestHandleReplanProgram_BadJSON tests that malformed JSON returns 400.
func TestHandleReplanProgram_BadJSON(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a valid PROGRAM manifest so resolveProgramPath succeeds.
	docsDir := filepath.Join(tmpDir, "docs")
	if err := os.MkdirAll(docsDir, 0755); err != nil {
		t.Fatal(err)
	}
	yamlContent := `title: Test Program
program_slug: test-replan
state: PLANNING
impls: []
tiers: []
completion:
  tiers_complete: 0
  tiers_total: 0
  impls_complete: 0
  impls_total: 0
  total_agents: 0
  total_waves: 0
`
	if err := os.WriteFile(filepath.Join(docsDir, "PROGRAM-test-replan.yaml"), []byte(yamlContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Write saw.config.json pointing to tmpDir as the repo root.
	cfg := SAWConfig{Repos: []RepoEntry{{Name: "repo", Path: tmpDir}}}
	cfgData, _ := json.Marshal(cfg)
	if err := os.WriteFile(filepath.Join(tmpDir, "saw.config.json"), cfgData, 0644); err != nil {
		t.Fatal(err)
	}

	serverCtx, serverCancel := context.WithCancel(context.Background())
	defer serverCancel()
	server := &Server{
		cfg:          Config{RepoPath: tmpDir, IMPLDir: docsDir},
		serverCtx:    serverCtx,
		serverCancel: serverCancel,
	}

	req := httptest.NewRequest("POST", "/api/program/test-replan/replan",
		strings.NewReader("{invalid json}"))
	req.SetPathValue("slug", "test-replan")
	w := httptest.NewRecorder()

	server.handleReplanProgram(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

// TestHandleGetProgramStatus_ValidationErrors tests that missing IMPL docs
// produce validation_errors in the response (U4).
func TestHandleGetProgramStatus_ValidationErrors(t *testing.T) {
	tmpDir := t.TempDir()

	repoDir := filepath.Join(tmpDir, "test-repo")
	docsDir := filepath.Join(repoDir, "docs")
	if err := os.MkdirAll(docsDir, 0755); err != nil {
		t.Fatal(err)
	}

	// PROGRAM manifest that references a non-existent IMPL slug.
	yamlContent := `title: Test Program
program_slug: test-validation
state: PLANNING
impls:
  - slug: missing-impl
    title: Missing Implementation
    tier: 1
    status: pending
tiers:
  - number: 1
    impls:
      - missing-impl
    description: First tier
completion:
  tiers_complete: 0
  tiers_total: 1
  impls_complete: 0
  impls_total: 1
  total_agents: 0
  total_waves: 0
`
	programPath := filepath.Join(docsDir, "PROGRAM-test-validation.yaml")
	if err := os.WriteFile(programPath, []byte(yamlContent), 0644); err != nil {
		t.Fatal(err)
	}

	configPath := filepath.Join(tmpDir, "saw.config.json")
	config := SAWConfig{
		Repos: []RepoEntry{{Name: "test-repo", Path: repoDir}},
	}
	configData, _ := json.Marshal(config)
	if err := os.WriteFile(configPath, configData, 0644); err != nil {
		t.Fatal(err)
	}

	serverCtx, serverCancel := context.WithCancel(context.Background())
	defer serverCancel()
	server := &Server{
		cfg: Config{
			RepoPath: tmpDir,
			IMPLDir:  docsDir,
		},
		serverCtx:    serverCtx,
		serverCancel: serverCancel,
	}

	req := httptest.NewRequest("GET", "/api/program/test-validation", nil)
	req.SetPathValue("slug", "test-validation")
	w := httptest.NewRecorder()

	server.handleGetProgramStatus(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp ProgramStatusResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(resp.ValidationErrors) == 0 {
		t.Error("expected validation_errors to be non-empty for missing IMPL")
	}

	found := false
	for _, e := range resp.ValidationErrors {
		if strings.Contains(e, "missing-impl") {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected validation_errors to mention 'missing-impl', got: %v", resp.ValidationErrors)
	}
}

// TestHandleExecuteTier_CleanupOnPathError verifies activeProgramRuns does not
// retain the slug when handleExecuteTier returns an error before goroutine launch (B3).
func TestHandleExecuteTier_CleanupOnPathError(t *testing.T) {
	tmpDir := t.TempDir()

	// No PROGRAM manifest — resolveProgramPath will fail.
	serverCtx, serverCancel := context.WithCancel(context.Background())
	defer serverCancel()
	server := &Server{
		cfg: Config{
			RepoPath: tmpDir,
			IMPLDir:  filepath.Join(tmpDir, "docs"),
		},
		broker:       &sseBroker{clients: make(map[string][]chan SSEEvent)},
		globalBroker: newGlobalBroker(),
		serverCtx:    serverCtx,
		serverCancel: serverCancel,
	}

	req := httptest.NewRequest("POST", "/api/program/no-such-prog/tier/1/execute", nil)
	req.SetPathValue("slug", "no-such-prog")
	req.SetPathValue("n", "1")
	w := httptest.NewRecorder()

	server.handleExecuteTier(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}

	// Verify the slug was cleaned up from activeProgramRuns.
	if _, loaded := server.activeProgramRuns.Load("no-such-prog"); loaded {
		t.Error("activeProgramRuns should not retain the slug after a path-resolution error")
	}
}
