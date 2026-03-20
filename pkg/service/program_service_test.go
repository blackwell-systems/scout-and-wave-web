package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// testDeps creates a Deps struct for testing with optional repos config.
func testDeps(t *testing.T, repos []RepoEntry) Deps {
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
	deps := testDeps(t, nil)

	programs, err := ListPrograms(deps)
	if err != nil {
		t.Fatalf("ListPrograms returned error: %v", err)
	}

	if len(programs) != 0 {
		t.Errorf("expected 0 programs, got %d", len(programs))
	}
}

func TestResolveProgramPath_NotFound(t *testing.T) {
	deps := testDeps(t, nil)

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
	ProgramRuns.active.Store(slug, struct{}{})
	defer ProgramRuns.active.Delete(slug)

	deps := testDeps(t, nil)

	err := ExecuteTier(deps, slug, 1, false)
	if err == nil {
		t.Fatal("expected error for concurrent execution, got nil")
	}
	expected := "program tier already executing"
	if err.Error() != expected {
		t.Errorf("expected error %q, got %q", expected, err.Error())
	}
}

func TestRunTracker_TryAcquireAndRelease(t *testing.T) {
	var rt RunTracker

	// First acquire should succeed
	if !rt.TryAcquire("slug-a") {
		t.Error("first TryAcquire should succeed")
	}

	// Second acquire same slug should fail
	if rt.TryAcquire("slug-a") {
		t.Error("second TryAcquire should fail for same slug")
	}

	// Different slug should succeed
	if !rt.TryAcquire("slug-b") {
		t.Error("TryAcquire should succeed for different slug")
	}

	// IsRunning checks
	if !rt.IsRunning("slug-a") {
		t.Error("slug-a should be running")
	}
	if rt.IsRunning("slug-c") {
		t.Error("slug-c should not be running")
	}

	// Release and re-acquire
	rt.Release("slug-a")
	if rt.IsRunning("slug-a") {
		t.Error("slug-a should not be running after release")
	}
	if !rt.TryAcquire("slug-a") {
		t.Error("TryAcquire should succeed after release")
	}

	rt.Release("slug-a")
	rt.Release("slug-b")
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
			acquired <- rt.TryAcquire(slug)
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

	rt.Release(slug)
}

func TestGetConfiguredRepos_Fallback(t *testing.T) {
	deps := testDeps(t, nil)
	repos := getConfiguredRepos(deps)

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
	deps := testDeps(t, configuredRepos)
	repos := getConfiguredRepos(deps)

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
