package service

import (
	"os"
	"path/filepath"
	"testing"
)

// implTestDeps creates a Deps suitable for testing with a temporary directory.
func implTestDeps(t *testing.T) (Deps, string) {
	t.Helper()
	tmpDir := t.TempDir()
	return Deps{
		RepoPath: tmpDir,
		IMPLDir:  filepath.Join(tmpDir, "docs", "IMPL"),
		ConfigPath: func(repoPath string) string {
			return filepath.Join(repoPath, "saw.config.json")
		},
	}, tmpDir
}

// writeIMPL creates a minimal IMPL YAML file in the given directory.
func writeIMPL(t *testing.T, dir, slug string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "IMPL-"+slug+".yaml")
	content := "feature: " + slug + "\nwaves: []\n"
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestListImpls_EmptyDir(t *testing.T) {
	deps, tmpDir := implTestDeps(t)
	// Create the IMPL dir but leave it empty
	implDir := filepath.Join(tmpDir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0755); err != nil {
		t.Fatal(err)
	}

	entries, err := ListImpls(deps)
	if err != nil {
		t.Fatalf("ListImpls returned error: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("expected 0 entries, got %d", len(entries))
	}
}

func TestListImpls_NonExistentDir(t *testing.T) {
	deps, _ := implTestDeps(t)
	// Don't create the IMPL dir at all

	entries, err := ListImpls(deps)
	if err != nil {
		t.Fatalf("ListImpls returned error: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("expected 0 entries for non-existent dir, got %d", len(entries))
	}
}

func TestListImpls_FindsYAMLFiles(t *testing.T) {
	deps, tmpDir := implTestDeps(t)
	implDir := filepath.Join(tmpDir, "docs", "IMPL")
	writeIMPL(t, implDir, "my-feature")
	writeIMPL(t, implDir, "other-feature")

	entries, err := ListImpls(deps)
	if err != nil {
		t.Fatalf("ListImpls returned error: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(entries))
	}

	slugs := map[string]bool{}
	for _, e := range entries {
		slugs[e.Slug] = true
		if e.DocStatus != "active" {
			t.Errorf("expected active status for %s, got %s", e.Slug, e.DocStatus)
		}
	}
	if !slugs["my-feature"] || !slugs["other-feature"] {
		t.Errorf("expected slugs my-feature and other-feature, got %v", slugs)
	}
}

func TestListImpls_CompleteDir(t *testing.T) {
	deps, tmpDir := implTestDeps(t)
	completeDir := filepath.Join(tmpDir, "docs", "IMPL", "complete")
	writeIMPL(t, completeDir, "done-feature")

	entries, err := ListImpls(deps)
	if err != nil {
		t.Fatalf("ListImpls returned error: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].DocStatus != "complete" {
		t.Errorf("expected complete status, got %s", entries[0].DocStatus)
	}
}

func TestFindImplPath_SearchesMultipleRepos(t *testing.T) {
	deps, _ := implTestDeps(t)

	// Create two repo dirs with config
	repo1 := t.TempDir()
	repo2 := t.TempDir()

	// Write IMPL in repo2 only
	writeIMPL(t, filepath.Join(repo2, "docs", "IMPL"), "target-feature")

	// Write config pointing to both repos
	configJSON := `{"repos":[{"name":"repo1","path":"` + repo1 + `"},{"name":"repo2","path":"` + repo2 + `"}]}`
	configPath := filepath.Join(deps.RepoPath, "saw.config.json")
	if err := os.WriteFile(configPath, []byte(configJSON), 0644); err != nil {
		t.Fatal(err)
	}

	path, repo, err := FindImplPath(deps, "target-feature")
	if err != nil {
		t.Fatalf("FindImplPath returned error: %v", err)
	}
	if repo.Name != "repo2" {
		t.Errorf("expected repo2, got %s", repo.Name)
	}
	if path == "" {
		t.Error("expected non-empty path")
	}
}

func TestFindImplPath_NotFound(t *testing.T) {
	deps, _ := implTestDeps(t)
	_, _, err := FindImplPath(deps, "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent slug")
	}
}

func TestFindImplPath_CompleteDirectory(t *testing.T) {
	deps, tmpDir := implTestDeps(t)
	completeDir := filepath.Join(tmpDir, "docs", "IMPL", "complete")
	writeIMPL(t, completeDir, "archived-feature")

	path, _, err := FindImplPath(deps, "archived-feature")
	if err != nil {
		t.Fatalf("FindImplPath returned error: %v", err)
	}
	if path == "" {
		t.Error("expected non-empty path for complete dir feature")
	}
}

func TestDeleteImpl_NotFound(t *testing.T) {
	deps, tmpDir := implTestDeps(t)
	// Create empty IMPL dir
	implDir := filepath.Join(tmpDir, "docs", "IMPL")
	if err := os.MkdirAll(implDir, 0755); err != nil {
		t.Fatal(err)
	}

	err := DeleteImpl(deps, "nonexistent")
	if err == nil {
		t.Fatal("expected error for deleting nonexistent IMPL")
	}
}

func TestDeleteImpl_Success(t *testing.T) {
	deps, tmpDir := implTestDeps(t)
	implDir := filepath.Join(tmpDir, "docs", "IMPL")
	path := writeIMPL(t, implDir, "to-delete")

	// Verify file exists
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("file should exist before delete: %v", err)
	}

	err := DeleteImpl(deps, "to-delete")
	if err != nil {
		t.Fatalf("DeleteImpl returned error: %v", err)
	}

	// Verify file is gone
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("file should not exist after delete")
	}
}

func TestArchiveImpl_Success(t *testing.T) {
	deps, tmpDir := implTestDeps(t)
	implDir := filepath.Join(tmpDir, "docs", "IMPL")
	writeIMPL(t, implDir, "to-archive")

	err := ArchiveImpl(deps, "to-archive")
	if err != nil {
		t.Fatalf("ArchiveImpl returned error: %v", err)
	}

	// Verify moved to complete/
	completePath := filepath.Join(implDir, "complete", "IMPL-to-archive.yaml")
	if _, err := os.Stat(completePath); err != nil {
		t.Error("file should exist in complete/ after archive")
	}

	// Verify removed from active
	activePath := filepath.Join(implDir, "IMPL-to-archive.yaml")
	if _, err := os.Stat(activePath); !os.IsNotExist(err) {
		t.Error("file should not exist in active dir after archive")
	}
}

func TestArchiveImpl_NotFound(t *testing.T) {
	deps, tmpDir := implTestDeps(t)
	if err := os.MkdirAll(filepath.Join(tmpDir, "docs", "IMPL"), 0755); err != nil {
		t.Fatal(err)
	}

	err := ArchiveImpl(deps, "nonexistent")
	if err == nil {
		t.Fatal("expected error for archiving nonexistent IMPL")
	}
}

func TestResolveIMPLPath_Success(t *testing.T) {
	deps, tmpDir := implTestDeps(t)
	implDir := filepath.Join(tmpDir, "docs", "IMPL")
	writeIMPL(t, implDir, "resolve-me")

	implPath, repoPath, err := ResolveIMPLPath(deps, "resolve-me")
	if err != nil {
		t.Fatalf("ResolveIMPLPath returned error: %v", err)
	}
	if implPath == "" {
		t.Error("expected non-empty implPath")
	}
	if repoPath != tmpDir {
		t.Errorf("expected repoPath %s, got %s", tmpDir, repoPath)
	}
}

func TestResolveIMPLPath_NotFound(t *testing.T) {
	deps, _ := implTestDeps(t)
	_, _, err := ResolveIMPLPath(deps, "nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent slug")
	}
}

func TestApproveImpl_PublishesEvent(t *testing.T) {
	deps, _ := implTestDeps(t)
	pub := &mockPublisher{}
	deps.Publisher = pub

	err := ApproveImpl(deps, "my-slug")
	if err != nil {
		t.Fatalf("ApproveImpl returned error: %v", err)
	}
	if len(pub.events) != 1 {
		t.Fatalf("expected 1 published event, got %d", len(pub.events))
	}
	if pub.events[0].Name != "plan_approved" {
		t.Errorf("expected plan_approved event, got %s", pub.events[0].Name)
	}
}

func TestRejectImpl_PublishesEvent(t *testing.T) {
	deps, _ := implTestDeps(t)
	pub := &mockPublisher{}
	deps.Publisher = pub

	err := RejectImpl(deps, "my-slug")
	if err != nil {
		t.Fatalf("RejectImpl returned error: %v", err)
	}
	if len(pub.events) != 1 {
		t.Fatalf("expected 1 published event, got %d", len(pub.events))
	}
	if pub.events[0].Name != "plan_rejected" {
		t.Errorf("expected plan_rejected event, got %s", pub.events[0].Name)
	}
}

func TestApproveImpl_NoPublisher(t *testing.T) {
	deps, _ := implTestDeps(t)
	// No publisher set
	err := ApproveImpl(deps, "my-slug")
	if err == nil {
		t.Fatal("expected error when no publisher configured")
	}
}

// mockPublisher captures published events for testing.
type mockPublisher struct {
	events []Event
}

func (m *mockPublisher) Publish(channel string, event Event) {
	m.events = append(m.events, event)
}

func (m *mockPublisher) Subscribe(channel string) (<-chan Event, func()) {
	ch := make(chan Event)
	return ch, func() { close(ch) }
}
