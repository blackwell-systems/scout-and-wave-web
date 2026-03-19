package api

import (
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

	server := &Server{
		cfg: Config{
			RepoPath: tmpDir,
			IMPLDir:  docsDir,
		},
		broker:       &sseBroker{clients: make(map[string][]chan SSEEvent)},
		globalBroker: newGlobalBroker(),
	}

	// Mark the program as already executing
	activeProgramRuns.Store("test-program", struct{}{})
	defer activeProgramRuns.Delete("test-program")

	req := httptest.NewRequest("POST", "/api/program/test-program/tier/1/execute", nil)
	req.SetPathValue("slug", "test-program")
	req.SetPathValue("n", "1")
	w := httptest.NewRecorder()

	server.handleExecuteTier(w, req)

	if w.Code != http.StatusConflict {
		t.Errorf("expected status 409, got %d", w.Code)
	}
}

// TestHandleReplanProgram_NotImplemented tests that replan returns 501.
func TestHandleReplanProgram_NotImplemented(t *testing.T) {
	server := &Server{}

	req := httptest.NewRequest("POST", "/api/program/test-program/replan", nil)
	req.SetPathValue("slug", "test-program")
	w := httptest.NewRecorder()

	server.handleReplanProgram(w, req)

	if w.Code != http.StatusNotImplemented {
		t.Errorf("expected status 501, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !strings.Contains(resp["message"], "Phase 4") {
		t.Errorf("expected message to mention Phase 4, got: %s", resp["message"])
	}
}
