package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// programTestDeps creates a Deps struct for testing with optional repos config.
func programTestDeps(t *testing.T, repos []RepoEntry) Deps {
	t.Helper()
	tmpDir := t.TempDir()

	if repos != nil {
		type sawConfig struct {
			Repos []RepoEntry `json:"repos,omitempty"`
		}
		cfg := sawConfig{Repos: repos}
		data, _ := json.Marshal(cfg)
		configPath := filepath.Join(tmpDir, "saw.config.json")
		os.WriteFile(configPath, data, 0644)
	}

	return Deps{
		RepoPath: tmpDir,
		IMPLDir:  filepath.Join(tmpDir, "docs", "IMPL"),
		ConfigPath: func(repoPath string) string {
			return filepath.Join(repoPath, "saw.config.json")
		},
	}
}

func TestListPrograms_EmptyRepos(t *testing.T) {
	deps := programTestDeps(t, nil)

	programs, err := ListPrograms(deps)
	if err != nil {
		t.Fatalf("ListPrograms returned error: %v", err)
	}

	if len(programs) != 0 {
		t.Errorf("expected 0 programs, got %d", len(programs))
	}
}

func TestResolveProgramPath_NotFound(t *testing.T) {
	deps := programTestDeps(t, nil)

	// Create docs dir but no program files
	os.MkdirAll(filepath.Join(deps.RepoPath, "docs"), 0755)

	_, _, err := ResolveProgramPath(deps, "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent program, got nil")
	}
	expected := "PROGRAM doc not found for slug: nonexistent"
	if err.Error() != expected {
		t.Errorf("expected error %q, got %q", expected, err.Error())
	}
}

func TestExecuteTier_ConcurrentGuard(t *testing.T) {
	// Pre-acquire the slug to simulate a running execution
	slug := "test-concurrent-guard"
	ProgramRuns.runs.Store(slug, struct{}{})
	defer ProgramRuns.runs.Delete(slug)

	deps := programTestDeps(t, nil)

	err := ExecuteTier(deps, slug, 1, false)
	if err == nil {
		t.Fatal("expected error for concurrent execution, got nil")
	}
	expected := "program tier already executing"
	if err.Error() != expected {
		t.Errorf("expected error %q, got %q", expected, err.Error())
	}
}

func TestRunTracker_TryStartAndRelease(t *testing.T) {
	var rt RunTracker

	// First acquire should succeed
	if !rt.TryStart("slug-a") {
		t.Error("first TryStart should succeed")
	}

	// Second acquire same slug should fail
	if rt.TryStart("slug-a") {
		t.Error("second TryStart should fail for same slug")
	}

	// Different slug should succeed
	if !rt.TryStart("slug-b") {
		t.Error("TryStart should succeed for different slug")
	}

	// IsRunning checks
	if !rt.IsRunning("slug-a") {
		t.Error("slug-a should be running")
	}
	if rt.IsRunning("slug-c") {
		t.Error("slug-c should not be running")
	}

	// Release and re-acquire
	rt.Done("slug-a")
	if rt.IsRunning("slug-a") {
		t.Error("slug-a should not be running after release")
	}
	if !rt.TryStart("slug-a") {
		t.Error("TryStart should succeed after release")
	}

	rt.Done("slug-a")
	rt.Done("slug-b")
}

func TestRunTracker_ConcurrentAccess(t *testing.T) {
	var rt RunTracker
	slug := "concurrent-slug"

	// Launch multiple goroutines trying to acquire the same slug
	const n = 50
	acquired := make(chan bool, n)
	var wg sync.WaitGroup

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			acquired <- rt.TryStart(slug)
		}()
	}

	wg.Wait()
	close(acquired)

	successCount := 0
	for got := range acquired {
		if got {
			successCount++
		}
	}

	if successCount != 1 {
		t.Errorf("expected exactly 1 successful acquire, got %d", successCount)
	}

	rt.Done(slug)
}

func TestProgramGetConfiguredRepos_Fallback(t *testing.T) {
	deps := programTestDeps(t, nil)
	repos := GetConfiguredRepos(deps)

	if len(repos) != 1 {
		t.Fatalf("expected 1 fallback repo, got %d", len(repos))
	}
	if repos[0].Path != deps.RepoPath {
		t.Errorf("expected fallback path %s, got %s", deps.RepoPath, repos[0].Path)
	}
}

func TestGetConfiguredRepos_FromConfig(t *testing.T) {
	configuredRepos := []RepoEntry{
		{Name: "repo1", Path: "/tmp/repo1"},
		{Name: "repo2", Path: "/tmp/repo2"},
	}
	deps := programTestDeps(t, configuredRepos)
	repos := GetConfiguredRepos(deps)

	if len(repos) != 2 {
		t.Fatalf("expected 2 repos from config, got %d", len(repos))
	}
	if repos[0].Name != "repo1" || repos[1].Name != "repo2" {
		t.Errorf("unexpected repo names: %v", repos)
	}
}

func TestResolveIMPLPathForProgram_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	_, err := ResolveIMPLPathForProgram("nonexistent", tmpDir)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestResolveIMPLPathForProgram_PrefersComplete(t *testing.T) {
	tmpDir := t.TempDir()

	// Create both active and complete versions
	activeDir := filepath.Join(tmpDir, "docs", "IMPL")
	completeDir := filepath.Join(tmpDir, "docs", "IMPL", "complete")
	os.MkdirAll(activeDir, 0755)
	os.MkdirAll(completeDir, 0755)

	os.WriteFile(filepath.Join(activeDir, "IMPL-test-slug.yaml"), []byte("active"), 0644)
	os.WriteFile(filepath.Join(completeDir, "IMPL-test-slug.yaml"), []byte("complete"), 0644)

	path, err := ResolveIMPLPathForProgram("test-slug", tmpDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should prefer complete directory
	expected := filepath.Join(completeDir, "IMPL-test-slug.yaml")
	if path != expected {
		t.Errorf("expected %s, got %s", expected, path)
	}
}

func TestAnalyzeImplConflicts_DefaultsToFirstRepo(t *testing.T) {
	dir := t.TempDir()

	implDir := filepath.Join(dir, "docs", "IMPL")
	os.MkdirAll(implDir, 0755)

	impl1 := `title: Impl One
slug: impl-one
state: reviewed
file_ownership:
  - file: pkg/shared.go
    agents: [A]
waves:
  - number: 1
    agents:
      - id: A
        files: [pkg/shared.go]
`
	impl2 := `title: Impl Two
slug: impl-two
state: reviewed
file_ownership:
  - file: pkg/other.go
    agents: [A]
waves:
  - number: 1
    agents:
      - id: A
        files: [pkg/other.go]
`
	os.WriteFile(filepath.Join(implDir, "IMPL-impl-one.yaml"), []byte(impl1), 0644)
	os.WriteFile(filepath.Join(implDir, "IMPL-impl-two.yaml"), []byte(impl2), 0644)

	deps := programTestDeps(t, []RepoEntry{{Name: "test", Path: dir}})

	report, err := AnalyzeImplConflicts(deps, []string{"impl-one", "impl-two"}, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if report == nil {
		t.Fatal("expected non-nil report")
	}
	if len(report.Conflicts) != 0 {
		t.Errorf("expected 0 conflicts, got %d", len(report.Conflicts))
	}
	if len(report.DisjointSets) == 0 {
		t.Error("expected disjoint sets to be populated")
	}
}

func TestAnalyzeImplConflicts_DetectsConflict(t *testing.T) {
	dir := t.TempDir()
	implDir := filepath.Join(dir, "docs", "IMPL")
	os.MkdirAll(implDir, 0755)

	impl1 := `title: A
slug: a
state: reviewed
file_ownership:
  - file: pkg/x.go
    agents: [A]
waves:
  - number: 1
    agents:
      - id: A
        files: [pkg/x.go]
`
	impl2 := `title: B
slug: b
state: reviewed
file_ownership:
  - file: pkg/x.go
    agents: [A]
waves:
  - number: 1
    agents:
      - id: A
        files: [pkg/x.go]
`
	os.WriteFile(filepath.Join(implDir, "IMPL-a.yaml"), []byte(impl1), 0644)
	os.WriteFile(filepath.Join(implDir, "IMPL-b.yaml"), []byte(impl2), 0644)

	deps := Deps{RepoPath: dir}
	report, err := AnalyzeImplConflicts(deps, []string{"a", "b"}, dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(report.Conflicts) != 1 {
		t.Errorf("expected 1 conflict, got %d", len(report.Conflicts))
	}
}

func TestCreateProgramFromIMPLs_WritesManifest(t *testing.T) {
	dir := t.TempDir()
	implDir := filepath.Join(dir, "docs", "IMPL")
	os.MkdirAll(implDir, 0755)
	os.MkdirAll(filepath.Join(dir, "docs"), 0755)

	impl1 := `title: Feature A
slug: feature-a
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
	os.WriteFile(filepath.Join(implDir, "IMPL-feature-a.yaml"), []byte(impl1), 0644)

	deps := Deps{RepoPath: dir}
	result, err := CreateProgramFromIMPLs(deps, []string{"feature-a"}, "My Program", "my-program", dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.IsSuccess() {
		t.Fatalf("expected successful result, got: %v", result.Errors)
	}
	if result.GetData().ManifestPath == "" {
		t.Error("expected manifest_path to be set")
	}

	expectedPath := filepath.Join(dir, "docs", "PROGRAM-my-program.yaml")
	if _, err := os.Stat(expectedPath); os.IsNotExist(err) {
		t.Errorf("expected PROGRAM manifest at %s", expectedPath)
	}
}

func TestCreateProgramFromIMPLs_NoRepoPath(t *testing.T) {
	// With config.LoadOrDefault, empty RepoPath resolves via cwd walk-up.
	// Use a truly isolated dir with no config ancestors to test the fallback.
	isolated := t.TempDir()
	origDir, _ := os.Getwd()
	os.Chdir(isolated)
	defer os.Chdir(origDir)

	deps := Deps{
		RepoPath: "",
		ConfigPath: func(repoPath string) string {
			return filepath.Join(repoPath, "saw.config.json")
		},
	}
	_, err := CreateProgramFromIMPLs(deps, []string{"x"}, "", "", "")
	if err == nil {
		t.Error("expected error when no repo path configured")
	}
}
