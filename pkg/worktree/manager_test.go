package worktree

import (
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"testing"
)

// initTestRepo creates a temporary git repository with an initial empty commit.
func initTestRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	cmds := [][]string{
		{"init"},
		{"config", "user.email", "test@test.com"},
		{"config", "user.name", "Test"},
		{"commit", "--allow-empty", "-m", "init"},
	}

	for _, args := range cmds {
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v failed: %v\n%s", args, err, out)
		}
	}

	return dir
}

func TestManager_Create(t *testing.T) {
	repoDir := initTestRepo(t)
	m := New(repoDir)

	wtPath, err := m.Create(1, "A")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	expectedPath := filepath.Join(repoDir, ".claude", "worktrees", "wave1-agent-A")
	if wtPath != expectedPath {
		t.Errorf("Create returned path %q, want %q", wtPath, expectedPath)
	}

	// Verify the directory exists
	if _, err := os.Stat(wtPath); os.IsNotExist(err) {
		t.Errorf("worktree directory %q does not exist after Create", wtPath)
	}

	// Verify it's tracked
	list := m.List()
	if len(list) != 1 || list[0] != wtPath {
		t.Errorf("List() = %v, want [%q]", list, wtPath)
	}
}

func TestManager_Remove(t *testing.T) {
	repoDir := initTestRepo(t)
	m := New(repoDir)

	wtPath, err := m.Create(1, "B")
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	err = m.Remove(wtPath)
	if err != nil {
		t.Fatalf("Remove failed: %v", err)
	}

	// Verify the directory no longer exists
	if _, err := os.Stat(wtPath); !os.IsNotExist(err) {
		t.Errorf("worktree directory %q still exists after Remove", wtPath)
	}

	// Verify it's no longer tracked
	list := m.List()
	if len(list) != 0 {
		t.Errorf("List() = %v after Remove, expected empty", list)
	}
}

func TestManager_CleanupAll(t *testing.T) {
	repoDir := initTestRepo(t)
	m := New(repoDir)

	wt1, err := m.Create(1, "X")
	if err != nil {
		t.Fatalf("Create wave1-agent-X failed: %v", err)
	}

	wt2, err := m.Create(1, "Y")
	if err != nil {
		t.Fatalf("Create wave1-agent-Y failed: %v", err)
	}

	err = m.CleanupAll()
	if err != nil {
		t.Fatalf("CleanupAll returned error: %v", err)
	}

	// Both worktree directories should be gone
	for _, path := range []string{wt1, wt2} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("worktree %q still exists after CleanupAll", path)
		}
	}

	// active map should be empty
	list := m.List()
	if len(list) != 0 {
		t.Errorf("List() = %v after CleanupAll, expected empty", list)
	}
}

func TestManager_List(t *testing.T) {
	repoDir := initTestRepo(t)
	m := New(repoDir)

	wt1, err := m.Create(2, "P")
	if err != nil {
		t.Fatalf("Create wave2-agent-P failed: %v", err)
	}

	wt2, err := m.Create(2, "Q")
	if err != nil {
		t.Fatalf("Create wave2-agent-Q failed: %v", err)
	}

	list := m.List()
	if len(list) != 2 {
		t.Fatalf("List() returned %d items, want 2: %v", len(list), list)
	}

	// Sort for deterministic comparison
	sort.Strings(list)
	expected := []string{wt1, wt2}
	sort.Strings(expected)

	for i, got := range list {
		if got != expected[i] {
			t.Errorf("List()[%d] = %q, want %q", i, got, expected[i])
		}
	}
}

func TestManager_Remove_Untracked(t *testing.T) {
	repoDir := initTestRepo(t)
	m := New(repoDir)

	err := m.Remove("/some/nonexistent/path")
	if err == nil {
		t.Fatal("expected error when removing untracked worktree, got nil")
	}
}
