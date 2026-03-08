package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// TestConfigMigration_LegacyRepoPath verifies that a legacy saw.config.json
// containing only the old "repo.path" field is automatically migrated to the
// new "repos" registry on GET /api/config, and that the legacy "repo" field
// is cleared from the response.
func TestConfigMigration_LegacyRepoPath(t *testing.T) {
	dir := t.TempDir()

	// Write a legacy config: only the old repo.path field, no repos array.
	legacyJSON := `{"repo":{"path":"/tmp/testrepo"}}`
	configPath := filepath.Join(dir, "saw.config.json")
	if err := os.WriteFile(configPath, []byte(legacyJSON), 0644); err != nil {
		t.Fatalf("failed to write legacy config: %v", err)
	}

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  dir,
		RepoPath: dir,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	rr := httptest.NewRecorder()
	s.handleGetConfig(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d; body: %s", rr.Code, rr.Body.String())
	}

	var got SAWConfig
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Assert repos has exactly one entry migrated from legacy repo.path
	if len(got.Repos) != 1 {
		t.Fatalf("expected 1 repo entry, got %d", len(got.Repos))
	}
	if got.Repos[0].Name != "repo" {
		t.Errorf("expected repos[0].name = %q, got %q", "repo", got.Repos[0].Name)
	}
	if got.Repos[0].Path != "/tmp/testrepo" {
		t.Errorf("expected repos[0].path = %q, got %q", "/tmp/testrepo", got.Repos[0].Path)
	}

	// Assert the legacy "repo" field is cleared (empty/zero-value) in the response.
	if got.Repo.Path != "" {
		t.Errorf("expected legacy repo.path to be empty in response, got %q", got.Repo.Path)
	}
}

// TestConfigMigration_NoMigrationWhenReposPresent verifies that if a config
// already has a populated repos array, no migration occurs and the data is
// returned as-is.
func TestConfigMigration_NoMigrationWhenReposPresent(t *testing.T) {
	dir := t.TempDir()

	modernJSON := `{"repos":[{"name":"main","path":"/home/user/project"}]}`
	configPath := filepath.Join(dir, "saw.config.json")
	if err := os.WriteFile(configPath, []byte(modernJSON), 0644); err != nil {
		t.Fatalf("failed to write modern config: %v", err)
	}

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  dir,
		RepoPath: dir,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	rr := httptest.NewRecorder()
	s.handleGetConfig(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rr.Code)
	}

	var got SAWConfig
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(got.Repos) != 1 {
		t.Fatalf("expected 1 repo entry, got %d", len(got.Repos))
	}
	if got.Repos[0].Name != "main" || got.Repos[0].Path != "/home/user/project" {
		t.Errorf("unexpected repos entry: %+v", got.Repos[0])
	}
}
