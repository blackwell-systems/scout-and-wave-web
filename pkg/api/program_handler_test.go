package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-web/pkg/service"
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

	// All entries appear in standalone — program membership is metadata, not a filter
	standaloneSlugs := make(map[string]string) // slug → program_slug
	for _, s := range resp.Standalone {
		standaloneSlugs[s.Slug] = s.ProgramSlug
	}
	if _, ok := standaloneSlugs["standalone-impl"]; !ok {
		t.Error("expected 'standalone-impl' in standalone list")
	}
	if _, ok := standaloneSlugs["done-impl"]; !ok {
		t.Error("expected 'done-impl' in standalone list")
	}
	// Program-linked IMPL appears in standalone with program_slug set
	if ps, ok := standaloneSlugs["program-impl"]; !ok {
		t.Error("expected 'program-impl' in standalone list (program membership is metadata)")
	} else if ps != "test-program" {
		t.Errorf("expected program-impl program_slug='test-program', got %q", ps)
	}
	// Non-program IMPLs should have empty program_slug
	if ps := standaloneSlugs["standalone-impl"]; ps != "" {
		t.Errorf("standalone-impl should have empty program_slug, got %q", ps)
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

// TestHandleAnalyzeImpls_TooFewSlugs tests that <2 slugs returns 400.
func TestHandleAnalyzeImpls_TooFewSlugs(t *testing.T) {
	tmpDir := t.TempDir()

	server := &Server{
		cfg: Config{RepoPath: tmpDir, IMPLDir: filepath.Join(tmpDir, "docs", "IMPL")},
		svcDeps: service.Deps{
			RepoPath: tmpDir,
			ConfigPath: func(repoPath string) string {
				return filepath.Join(repoPath, "saw.config.json")
			},
		},
	}

	// Test with 0 slugs
	req := httptest.NewRequest("POST", "/api/programs/analyze-impls",
		strings.NewReader(`{"slugs":[]}`))
	w := httptest.NewRecorder()
	server.handleAnalyzeImpls(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for 0 slugs, got %d", w.Code)
	}

	// Test with 1 slug
	req = httptest.NewRequest("POST", "/api/programs/analyze-impls",
		strings.NewReader(`{"slugs":["only-one"]}`))
	w = httptest.NewRecorder()
	server.handleAnalyzeImpls(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for 1 slug, got %d", w.Code)
	}
}

// TestHandleAnalyzeImpls_ValidReport tests valid conflict analysis.
func TestHandleAnalyzeImpls_ValidReport(t *testing.T) {
	tmpDir := t.TempDir()

	repoDir := filepath.Join(tmpDir, "test-repo")
	implDir := filepath.Join(repoDir, "docs", "IMPL")
	os.MkdirAll(implDir, 0755)

	impl1 := `title: Impl One
slug: impl-one
state: reviewed
file_ownership:
  - file: pkg/a.go
    agents: [A]
waves:
  - number: 1
    agents:
      - id: A
        files: [pkg/a.go]
`
	impl2 := `title: Impl Two
slug: impl-two
state: reviewed
file_ownership:
  - file: pkg/b.go
    agents: [A]
waves:
  - number: 1
    agents:
      - id: A
        files: [pkg/b.go]
`
	os.WriteFile(filepath.Join(implDir, "IMPL-impl-one.yaml"), []byte(impl1), 0644)
	os.WriteFile(filepath.Join(implDir, "IMPL-impl-two.yaml"), []byte(impl2), 0644)

	configPath := filepath.Join(tmpDir, "saw.config.json")
	cfgData, _ := json.Marshal(SAWConfig{Repos: []RepoEntry{{Name: "test", Path: repoDir}}})
	os.WriteFile(configPath, cfgData, 0644)

	server := &Server{
		cfg: Config{RepoPath: tmpDir, IMPLDir: implDir},
		svcDeps: service.Deps{
			RepoPath: tmpDir,
			ConfigPath: func(repoPath string) string {
				return filepath.Join(repoPath, "saw.config.json")
			},
		},
	}

	body := `{"slugs":["impl-one","impl-two"],"repo_path":"` + repoDir + `"}`
	req := httptest.NewRequest("POST", "/api/programs/analyze-impls",
		strings.NewReader(body))
	w := httptest.NewRecorder()
	server.handleAnalyzeImpls(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var report protocol.ConflictReport
	if err := json.NewDecoder(w.Body).Decode(&report); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	// No conflicts since files are disjoint
	if len(report.Conflicts) != 0 {
		t.Errorf("expected 0 conflicts, got %d", len(report.Conflicts))
	}
}

// TestHandleCreateFromImpls_TooFewSlugs tests that 0 slugs returns 400.
func TestHandleCreateFromImpls_TooFewSlugs(t *testing.T) {
	tmpDir := t.TempDir()

	server := &Server{
		cfg: Config{RepoPath: tmpDir},
		svcDeps: service.Deps{
			RepoPath: tmpDir,
			ConfigPath: func(repoPath string) string {
				return filepath.Join(repoPath, "saw.config.json")
			},
		},
	}

	req := httptest.NewRequest("POST", "/api/programs/create-from-impls",
		strings.NewReader(`{"slugs":[]}`))
	w := httptest.NewRecorder()
	server.handleCreateFromImpls(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for 0 slugs, got %d", w.Code)
	}
}

// TestHandleCreateFromImpls_CreatesManifest tests successful program creation.
func TestHandleCreateFromImpls_CreatesManifest(t *testing.T) {
	tmpDir := t.TempDir()

	repoDir := filepath.Join(tmpDir, "test-repo")
	implDir := filepath.Join(repoDir, "docs", "IMPL")
	os.MkdirAll(implDir, 0755)
	os.MkdirAll(filepath.Join(repoDir, "docs"), 0755)

	impl1 := `title: Feature Alpha
slug: feature-alpha
state: reviewed
file_ownership:
  - file: pkg/alpha.go
    agents: [A]
waves:
  - number: 1
    agents:
      - id: A
        files: [pkg/alpha.go]
`
	os.WriteFile(filepath.Join(implDir, "IMPL-feature-alpha.yaml"), []byte(impl1), 0644)

	configPath := filepath.Join(tmpDir, "saw.config.json")
	cfgData, _ := json.Marshal(SAWConfig{Repos: []RepoEntry{{Name: "test", Path: repoDir}}})
	os.WriteFile(configPath, cfgData, 0644)

	server := &Server{
		cfg:          Config{RepoPath: tmpDir, IMPLDir: implDir},
		globalBroker: newGlobalBroker(),
		svcDeps: service.Deps{
			RepoPath: tmpDir,
			ConfigPath: func(repoPath string) string {
				return filepath.Join(repoPath, "saw.config.json")
			},
		},
	}

	body := `{"slugs":["feature-alpha"],"name":"Test Program","program_slug":"test-create","repo_path":"` + repoDir + `"}`
	req := httptest.NewRequest("POST", "/api/programs/create-from-impls",
		strings.NewReader(body))
	w := httptest.NewRecorder()
	server.handleCreateFromImpls(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var result protocol.GenerateProgramResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if result.ManifestPath == "" {
		t.Error("expected manifest_path to be set")
	}

	// Verify file on disk
	expectedPath := filepath.Join(repoDir, "docs", "PROGRAM-test-create.yaml")
	if _, err := os.Stat(expectedPath); os.IsNotExist(err) {
		t.Errorf("expected PROGRAM manifest at %s", expectedPath)
	}
}

// TestHandleExecuteTier_IMPLBranchIsolation verifies that MergeTarget flows
// through tier execution and that impl_branch_created SSE events are emitted
// for each IMPL in the tier with the correct ProgramBranchName.
func TestHandleExecuteTier_IMPLBranchIsolation(t *testing.T) {
	tmpDir := t.TempDir()

	repoDir := filepath.Join(tmpDir, "test-repo")
	docsDir := filepath.Join(repoDir, "docs")
	implDir := filepath.Join(docsDir, "IMPL")
	if err := os.MkdirAll(implDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a PROGRAM manifest with 2 IMPLs in tier 1
	programContent := `title: Branch Isolation Test
program_slug: branch-test
state: PLANNING
impls:
  - slug: impl-alpha
    title: Alpha
    tier: 1
    status: pending
  - slug: impl-beta
    title: Beta
    tier: 1
    status: pending
tiers:
  - number: 1
    impls:
      - impl-alpha
      - impl-beta
    description: First tier
completion:
  tiers_complete: 0
  tiers_total: 1
  impls_complete: 0
  impls_total: 2
  total_agents: 0
  total_waves: 0
`
	if err := os.WriteFile(filepath.Join(docsDir, "PROGRAM-branch-test.yaml"), []byte(programContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Create stub IMPL docs so the service layer can resolve them
	for _, slug := range []string{"impl-alpha", "impl-beta"} {
		implContent := "title: " + slug + "\nfeature_slug: " + slug + "\n"
		if err := os.WriteFile(filepath.Join(implDir, "IMPL-"+slug+".yaml"), []byte(implContent), 0644); err != nil {
			t.Fatal(err)
		}
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

	broker := newGlobalBroker()
	server := &Server{
		cfg: Config{
			RepoPath: tmpDir,
			IMPLDir:  docsDir,
		},
		broker:       &sseBroker{clients: make(map[string][]chan SSEEvent)},
		globalBroker: broker,
		serverCtx:    serverCtx,
		serverCancel: serverCancel,
	}

	// Subscribe to capture SSE events
	ch := broker.subscribe()
	defer broker.unsubscribe(ch)

	req := httptest.NewRequest("POST", "/api/program/branch-test/tier/1/execute", nil)
	req.SetPathValue("slug", "branch-test")
	req.SetPathValue("n", "1")
	w := httptest.NewRecorder()

	server.handleExecuteTier(w, req)

	// The handler returns 202 (service.ExecuteTier launches async).
	// It may return 404 if the service can't fully resolve, but the SSE events
	// are emitted before the service call check, so we verify events regardless.

	// Collect events emitted (with short timeout)
	var events []string
	timeout := time.After(500 * time.Millisecond)
	for collecting := true; collecting; {
		select {
		case event := <-ch:
			events = append(events, event)
		case <-timeout:
			collecting = false
		}
	}

	// Verify impl_branch_created events were emitted for both IMPLs
	expectedBranches := map[string]bool{
		protocol.ProgramBranchName("branch-test", 1, "impl-alpha"): false,
		protocol.ProgramBranchName("branch-test", 1, "impl-beta"):  false,
	}

	for _, event := range events {
		if strings.HasPrefix(event, ProgramEventImplBranchCreated+":") {
			for branch := range expectedBranches {
				if strings.Contains(event, branch) {
					expectedBranches[branch] = true
				}
			}
		}
	}

	for branch, found := range expectedBranches {
		if !found {
			t.Errorf("expected impl_branch_created event for branch %q, but it was not emitted", branch)
		}
	}

	// Cleanup: the service.ExecuteTier goroutine may still be running
	service.ProgramRuns.Done("branch-test")
}

// TestHandleExecuteTier_BackwardCompat verifies that non-program wave execution
// (standalone IMPLs not part of any program) is unaffected by the MergeTarget
// changes. The handler should not emit impl_branch_created events when there
// is no program context.
func TestHandleExecuteTier_BackwardCompat(t *testing.T) {
	tmpDir := t.TempDir()

	repoDir := filepath.Join(tmpDir, "test-repo")
	docsDir := filepath.Join(repoDir, "docs")
	if err := os.MkdirAll(docsDir, 0755); err != nil {
		t.Fatal(err)
	}

	// No PROGRAM manifest — this simulates a standalone IMPL scenario
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

	broker := newGlobalBroker()
	server := &Server{
		cfg: Config{
			RepoPath: tmpDir,
			IMPLDir:  docsDir,
		},
		broker:       &sseBroker{clients: make(map[string][]chan SSEEvent)},
		globalBroker: broker,
		serverCtx:    serverCtx,
		serverCancel: serverCancel,
	}

	// Subscribe to capture SSE events
	ch := broker.subscribe()
	defer broker.unsubscribe(ch)

	req := httptest.NewRequest("POST", "/api/program/nonexistent-program/tier/1/execute", nil)
	req.SetPathValue("slug", "nonexistent-program")
	req.SetPathValue("n", "1")
	w := httptest.NewRecorder()

	server.handleExecuteTier(w, req)

	// Should return 404 since no program exists
	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 for non-program request, got %d", w.Code)
	}

	// Collect events with short timeout
	var branchEvents []string
	timeout := time.After(200 * time.Millisecond)
	for collecting := true; collecting; {
		select {
		case event := <-ch:
			if strings.HasPrefix(event, ProgramEventImplBranchCreated+":") {
				branchEvents = append(branchEvents, event)
			}
		case <-timeout:
			collecting = false
		}
	}

	// No impl_branch_created events should be emitted for non-program execution
	if len(branchEvents) != 0 {
		t.Errorf("expected no impl_branch_created events for non-program execution, got %d: %v",
			len(branchEvents), branchEvents)
	}
}

// TestEmitImplBranchMerged verifies the EmitImplBranchMerged helper emits
// the correct SSE event with ProgramBranchName.
func TestEmitImplBranchMerged(t *testing.T) {
	broker := newGlobalBroker()
	server := &Server{
		globalBroker: broker,
	}

	ch := broker.subscribe()
	defer broker.unsubscribe(ch)

	server.EmitImplBranchMerged("my-program", 2, "my-impl")

	expectedBranch := protocol.ProgramBranchName("my-program", 2, "my-impl")

	select {
	case event := <-ch:
		if !strings.HasPrefix(event, ProgramEventImplBranchMerged+":") {
			t.Errorf("expected event prefix %q, got %q", ProgramEventImplBranchMerged+":", event)
		}
		if !strings.Contains(event, expectedBranch) {
			t.Errorf("expected event to contain branch %q, got %q", expectedBranch, event)
		}
		if !strings.Contains(event, "my-program") {
			t.Errorf("expected event to contain program slug, got %q", event)
		}
		if !strings.Contains(event, "my-impl") {
			t.Errorf("expected event to contain impl slug, got %q", event)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timeout waiting for impl_branch_merged event")
	}
}
