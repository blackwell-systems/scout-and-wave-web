package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestParseWorktreePorcelain_MergedBranch(t *testing.T) {
	data := []byte("worktree /tmp/repo/.claude/worktrees/wave1-agent-A\nHEAD abc123\nbranch refs/heads/wave1-agent-A\n\n")
	merged := map[string]bool{"wave1-agent-A": true}

	entries := parseWorktreePorcelain(data, merged)

	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Branch != "wave1-agent-A" {
		t.Errorf("expected branch wave1-agent-A, got %s", entries[0].Branch)
	}
	if entries[0].Status != "merged" {
		t.Errorf("expected status merged, got %s", entries[0].Status)
	}
}

func TestParseWorktreePorcelain_UnmergedBranch(t *testing.T) {
	data := []byte("worktree /tmp/repo/.claude/worktrees/wave2-agent-B\nHEAD def456\nbranch refs/heads/wave2-agent-B\n\n")
	merged := map[string]bool{}

	entries := parseWorktreePorcelain(data, merged)

	if len(entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(entries))
	}
	if entries[0].Status != "unmerged" {
		t.Errorf("expected status unmerged, got %s", entries[0].Status)
	}
}

func TestParseWorktreePorcelain_FiltersNonSAWBranches(t *testing.T) {
	data := []byte("worktree /tmp/repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /tmp/repo/.claude/worktrees/wave1-agent-A\nHEAD def456\nbranch refs/heads/wave1-agent-A\n\nworktree /tmp/repo/feature\nHEAD ghi789\nbranch refs/heads/feature-branch\n\n")
	merged := map[string]bool{}

	entries := parseWorktreePorcelain(data, merged)

	if len(entries) != 1 {
		t.Fatalf("expected 1 SAW entry, got %d", len(entries))
	}
	if entries[0].Branch != "wave1-agent-A" {
		t.Errorf("expected wave1-agent-A, got %s", entries[0].Branch)
	}
}

func TestParseWorktreePorcelain_MultipleBranches(t *testing.T) {
	data := []byte("worktree /tmp/w1a\nHEAD aaa\nbranch refs/heads/wave1-agent-A\n\nworktree /tmp/w1b\nHEAD bbb\nbranch refs/heads/wave1-agent-B\n\nworktree /tmp/w2a\nHEAD ccc\nbranch refs/heads/wave2-agent-A\n\n")
	merged := map[string]bool{"wave1-agent-A": true, "wave1-agent-B": true}

	entries := parseWorktreePorcelain(data, merged)

	if len(entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(entries))
	}

	// First two should be merged, third unmerged
	if entries[0].Status != "merged" {
		t.Errorf("wave1-agent-A should be merged, got %s", entries[0].Status)
	}
	if entries[1].Status != "merged" {
		t.Errorf("wave1-agent-B should be merged, got %s", entries[1].Status)
	}
	if entries[2].Status != "unmerged" {
		t.Errorf("wave2-agent-A should be unmerged, got %s", entries[2].Status)
	}
}

func TestParseWorktreePorcelain_EmptyInput(t *testing.T) {
	entries := parseWorktreePorcelain([]byte(""), map[string]bool{})
	if len(entries) != 0 {
		t.Fatalf("expected 0 entries, got %d", len(entries))
	}
}

func TestHandleBatchDeleteWorktrees_EmptyBranches(t *testing.T) {
	s := &Server{cfg: Config{RepoPath: "/tmp/nonexistent"}}

	body, _ := json.Marshal(WorktreeBatchDeleteRequest{Branches: []string{}, Force: false})
	req := httptest.NewRequest(http.MethodPost, "/api/impl/test/worktrees/cleanup", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	s.handleBatchDeleteWorktrees(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandleBatchDeleteWorktrees_InvalidJSON(t *testing.T) {
	s := &Server{cfg: Config{RepoPath: "/tmp/nonexistent"}}

	req := httptest.NewRequest(http.MethodPost, "/api/impl/test/worktrees/cleanup", bytes.NewReader([]byte("not json")))
	rec := httptest.NewRecorder()

	s.handleBatchDeleteWorktrees(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandleBatchDeleteWorktrees_UnmergedConflict(t *testing.T) {
	// Use a temp git repo so getMergedBranches can run.
	// The branches we request won't be merged, so we'll get a 409.
	repoDir := initGitRepo(t)

	// Create a minimal IMPL doc so resolveIMPLPath doesn't 404
	implDir := repoDir + "/docs/IMPL"
	if err := os.MkdirAll(implDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(implDir+"/IMPL-test.yaml", []byte("title: test\nfeature_slug: test\nverdict: SUITABLE\n"), 0644); err != nil {
		t.Fatal(err)
	}

	s := &Server{cfg: Config{RepoPath: repoDir}}

	body, _ := json.Marshal(WorktreeBatchDeleteRequest{
		Branches: []string{"wave1-agent-X", "wave1-agent-Y"},
		Force:    false,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/impl/test/worktrees/cleanup", bytes.NewReader(body))
	req.SetPathValue("slug", "test")
	rec := httptest.NewRecorder()

	s.handleBatchDeleteWorktrees(rec, req)

	if rec.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["error"] != "unmerged branches exist" {
		t.Errorf("expected 'unmerged branches exist', got %v", resp["error"])
	}
	unmerged, ok := resp["unmerged"].([]interface{})
	if !ok || len(unmerged) != 2 {
		t.Errorf("expected 2 unmerged branches, got %v", resp["unmerged"])
	}
}

