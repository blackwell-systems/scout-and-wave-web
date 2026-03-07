package git

import (
	"os/exec"
	"strings"
	"testing"
)

// initTestRepo creates a temporary git repository with an initial empty commit
// and returns the path to the repo directory.
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

func TestRun_Success(t *testing.T) {
	dir := initTestRepo(t)

	out, err := Run(dir, "status")
	if err != nil {
		t.Fatalf("Run(git status) returned error: %v", err)
	}
	if out == "" {
		t.Error("expected non-empty output from git status")
	}
}

func TestRun_InvalidRepo(t *testing.T) {
	dir := t.TempDir() // Not a git repo

	_, err := Run(dir, "status")
	if err == nil {
		t.Fatal("expected error for non-git directory, got nil")
	}
}

func TestRevParse_HEAD(t *testing.T) {
	dir := initTestRepo(t)

	sha, err := RevParse(dir, "HEAD")
	if err != nil {
		t.Fatalf("RevParse(HEAD) returned error: %v", err)
	}

	if len(sha) != 40 {
		t.Errorf("expected 40-char SHA, got %d chars: %q", len(sha), sha)
	}

	// Verify it's hex
	for _, c := range sha {
		if !strings.ContainsRune("0123456789abcdef", c) {
			t.Errorf("SHA contains non-hex character %q in %q", c, sha)
			break
		}
	}
}

func TestWorktreeAdd_Remove(t *testing.T) {
	dir := initTestRepo(t)

	wtPath := t.TempDir()
	branch := "test-worktree-branch"

	err := WorktreeAdd(dir, wtPath, branch)
	if err != nil {
		t.Fatalf("WorktreeAdd failed: %v", err)
	}

	// List should include the new worktree
	pairs, err := WorktreeList(dir)
	if err != nil {
		t.Fatalf("WorktreeList failed: %v", err)
	}

	found := false
	for _, pair := range pairs {
		if pair[1] == branch {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("worktree with branch %q not found in list: %v", branch, pairs)
	}

	err = WorktreeRemove(dir, wtPath)
	if err != nil {
		t.Fatalf("WorktreeRemove failed: %v", err)
	}
}

func TestDiffNameOnly_NoChanges(t *testing.T) {
	dir := initTestRepo(t)

	sha, err := RevParse(dir, "HEAD")
	if err != nil {
		t.Fatalf("RevParse failed: %v", err)
	}

	files, err := DiffNameOnly(dir, sha, sha)
	if err != nil {
		t.Fatalf("DiffNameOnly failed: %v", err)
	}

	if len(files) != 0 {
		t.Errorf("expected 0 changed files for same ref diff, got: %v", files)
	}
}
