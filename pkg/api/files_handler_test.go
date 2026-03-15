package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// setupFilesRepo creates a temporary git-initialised repository with a small
// file structure suitable for file-browser tests.  It returns the repo root
// path and a *Server configured to serve that repo under the name "testrepo".
func setupFilesRepo(t *testing.T) (string, *Server) {
	t.Helper()

	repoDir := initGitRepo(t)

	// Create a small directory tree.
	mustMkdir := func(parts ...string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Join(append([]string{repoDir}, parts...)...), 0755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	mustWrite := func(content string, parts ...string) {
		t.Helper()
		p := filepath.Join(append([]string{repoDir}, parts...)...)
		if err := os.WriteFile(p, []byte(content), 0644); err != nil {
			t.Fatalf("write file %s: %v", p, err)
		}
	}

	mustMkdir("pkg", "foo")
	mustWrite("package foo\n", "pkg", "foo", "foo.go")
	mustWrite("export const x = 1;\n", "pkg", "foo", "util.ts")
	mustWrite("# README\n", "README.md")

	// Write saw.config.json so resolveRepoPath can locate "testrepo".
	cfg := `{"repos":[{"name":"testrepo","path":"` + repoDir + `"}]}`
	if err := os.WriteFile(filepath.Join(repoDir, "saw.config.json"), []byte(cfg), 0644); err != nil {
		t.Fatalf("write saw.config.json: %v", err)
	}

	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  repoDir,
		RepoPath: repoDir,
	})
	return repoDir, s
}

// ── GET /api/files/tree ──────────────────────────────────────────────────────

// TestHandleFilesTree_Basic verifies that the tree endpoint returns a valid
// recursive FileTreeResponse for a known repo.
func TestHandleFilesTree_Basic(t *testing.T) {
	_, s := setupFilesRepo(t)

	req := httptest.NewRequest(http.MethodGet, "/api/files/tree?repo=testrepo", nil)
	rr := httptest.NewRecorder()
	s.handleFilesTree(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rr.Code, rr.Body.String())
	}

	var resp FileTreeResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if resp.Repo != "testrepo" {
		t.Errorf("expected repo=testrepo, got %q", resp.Repo)
	}
	if !resp.Root.IsDir {
		t.Error("root node should be a directory")
	}

	// Verify we can find at least the pkg directory and README.md in the tree.
	findNode := func(name string) bool {
		var walk func(n FileNode) bool
		walk = func(n FileNode) bool {
			if n.Name == name {
				return true
			}
			for _, c := range n.Children {
				if walk(c) {
					return true
				}
			}
			return false
		}
		return walk(resp.Root)
	}

	for _, want := range []string{"pkg", "README.md", "foo.go"} {
		if !findNode(want) {
			t.Errorf("expected to find node %q in tree, but did not", want)
		}
	}
}

// TestHandleFilesTree_MissingRepo verifies that an unknown repo name returns 400.
func TestHandleFilesTree_MissingRepo(t *testing.T) {
	_, s := setupFilesRepo(t)

	req := httptest.NewRequest(http.MethodGet, "/api/files/tree?repo=doesnotexist", nil)
	rr := httptest.NewRecorder()
	s.handleFilesTree(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

// TestHandleFilesTree_PathEscape verifies that paths containing "../" are rejected
// with a 400 Bad Request to prevent directory traversal attacks.
func TestHandleFilesTree_PathEscape(t *testing.T) {
	_, s := setupFilesRepo(t)

	req := httptest.NewRequest(http.MethodGet, "/api/files/tree?repo=testrepo&path=../../etc", nil)
	rr := httptest.NewRecorder()
	s.handleFilesTree(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for path escape, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "escapes") {
		t.Errorf("expected 'escapes' in error message, got %q", rr.Body.String())
	}
}

// TestHandleFilesTree_SkipsGitDir verifies that the .git directory is not
// included in the returned tree.
func TestHandleFilesTree_SkipsGitDir(t *testing.T) {
	_, s := setupFilesRepo(t)

	req := httptest.NewRequest(http.MethodGet, "/api/files/tree?repo=testrepo", nil)
	rr := httptest.NewRecorder()
	s.handleFilesTree(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	var resp FileTreeResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	var walk func(n FileNode) bool
	walk = func(n FileNode) bool {
		if n.Name == ".git" {
			return true
		}
		for _, c := range n.Children {
			if walk(c) {
				return true
			}
		}
		return false
	}
	if walk(resp.Root) {
		t.Error("tree should not contain .git directory")
	}
}

// ── GET /api/files/read ──────────────────────────────────────────────────────

// TestHandleFilesRead_Success verifies that a valid text file is returned with
// correct content and language detection.
func TestHandleFilesRead_Success(t *testing.T) {
	repoDir, s := setupFilesRepo(t)
	_ = repoDir

	req := httptest.NewRequest(http.MethodGet, "/api/files/read?repo=testrepo&path=pkg/foo/foo.go", nil)
	rr := httptest.NewRecorder()
	s.handleFilesRead(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rr.Code, rr.Body.String())
	}

	var resp FileContentResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if resp.Repo != "testrepo" {
		t.Errorf("expected repo=testrepo, got %q", resp.Repo)
	}
	if resp.Path != "pkg/foo/foo.go" {
		t.Errorf("expected path=pkg/foo/foo.go, got %q", resp.Path)
	}
	if !strings.Contains(resp.Content, "package foo") {
		t.Errorf("expected content to contain 'package foo', got %q", resp.Content)
	}
	if resp.Language != "go" {
		t.Errorf("expected language=go, got %q", resp.Language)
	}
	if resp.Size == 0 {
		t.Error("expected non-zero size")
	}
}

// TestHandleFilesRead_TooLarge verifies that files exceeding 1 MB are rejected
// with 413 Payload Too Large.
func TestHandleFilesRead_TooLarge(t *testing.T) {
	repoDir, s := setupFilesRepo(t)

	// Write a file that is exactly 1 MB + 1 byte.
	bigFile := filepath.Join(repoDir, "big.bin")
	data := make([]byte, 1048577) // 1 MB + 1
	for i := range data {
		data[i] = 'a' // printable bytes so binary detection doesn't trigger first
	}
	if err := os.WriteFile(bigFile, data, 0644); err != nil {
		t.Fatalf("write big file: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/files/read?repo=testrepo&path=big.bin", nil)
	rr := httptest.NewRecorder()
	s.handleFilesRead(rr, req)

	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413, got %d; body: %s", rr.Code, rr.Body.String())
	}
}

// TestHandleFilesRead_Binary verifies that files containing null bytes are
// rejected with 415 Unsupported Media Type.
func TestHandleFilesRead_Binary(t *testing.T) {
	repoDir, s := setupFilesRepo(t)

	// Write a file with a null byte in the first 512 bytes.
	binaryFile := filepath.Join(repoDir, "image.png")
	data := []byte{0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x1a} // PNG-like header with null byte
	if err := os.WriteFile(binaryFile, data, 0644); err != nil {
		t.Fatalf("write binary file: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/files/read?repo=testrepo&path=image.png", nil)
	rr := httptest.NewRecorder()
	s.handleFilesRead(rr, req)

	if rr.Code != http.StatusUnsupportedMediaType {
		t.Errorf("expected 415, got %d; body: %s", rr.Code, rr.Body.String())
	}
}

// TestHandleFilesRead_PathEscape verifies path escapes are rejected.
func TestHandleFilesRead_PathEscape(t *testing.T) {
	_, s := setupFilesRepo(t)

	req := httptest.NewRequest(http.MethodGet, "/api/files/read?repo=testrepo&path=../../etc/passwd", nil)
	rr := httptest.NewRecorder()
	s.handleFilesRead(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

// ── GET /api/files/diff ──────────────────────────────────────────────────────

// TestHandleFilesDiff_Modified verifies that the diff endpoint returns a JSON
// body with repo, path, and diff keys for a modified file. The diff string
// may be empty if the file has no uncommitted changes, but the response
// must be valid JSON with the expected shape.
func TestHandleFilesDiff_Modified(t *testing.T) {
	repoDir, s := setupFilesRepo(t)

	// Modify a tracked file so git diff has something to report.
	modFile := filepath.Join(repoDir, "README.md")
	if err := os.WriteFile(modFile, []byte("# Modified README\n"), 0644); err != nil {
		t.Fatalf("write file: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/files/diff?repo=testrepo&path=README.md", nil)
	rr := httptest.NewRecorder()
	s.handleFilesDiff(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rr.Code, rr.Body.String())
	}

	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if resp["repo"] != "testrepo" {
		t.Errorf("expected repo=testrepo, got %q", resp["repo"])
	}
	if resp["path"] != "README.md" {
		t.Errorf("expected path=README.md, got %q", resp["path"])
	}
	// diff key must exist (value may be empty for untracked files)
	if _, ok := resp["diff"]; !ok {
		t.Error("response missing 'diff' key")
	}
}

// TestHandleFilesDiff_PathEscape verifies that path escapes return 400.
func TestHandleFilesDiff_PathEscape(t *testing.T) {
	_, s := setupFilesRepo(t)

	req := httptest.NewRequest(http.MethodGet, "/api/files/diff?repo=testrepo&path=../../secret", nil)
	rr := httptest.NewRecorder()
	s.handleFilesDiff(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

// ── GET /api/files/status ────────────────────────────────────────────────────

// TestHandleFilesStatus_Success verifies that the status endpoint returns a
// valid GitStatusResponse.  The files slice may be empty in a clean repo.
func TestHandleFilesStatus_Success(t *testing.T) {
	_, s := setupFilesRepo(t)

	req := httptest.NewRequest(http.MethodGet, "/api/files/status?repo=testrepo", nil)
	rr := httptest.NewRecorder()
	s.handleFilesStatus(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rr.Code, rr.Body.String())
	}

	var resp GitStatusResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if resp.Repo != "testrepo" {
		t.Errorf("expected repo=testrepo, got %q", resp.Repo)
	}
	if resp.Files == nil {
		t.Error("expected non-nil Files slice (may be empty)")
	}
}

// TestHandleFilesStatus_ShowsUntracked verifies that newly created (untracked)
// files appear in the status response with status "U".
func TestHandleFilesStatus_ShowsUntracked(t *testing.T) {
	repoDir, s := setupFilesRepo(t)

	// Create an untracked file (not staged, not committed).
	untrackedFile := filepath.Join(repoDir, "newfile.txt")
	if err := os.WriteFile(untrackedFile, []byte("hello"), 0644); err != nil {
		t.Fatalf("write untracked file: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/files/status?repo=testrepo", nil)
	rr := httptest.NewRecorder()
	s.handleFilesStatus(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	var resp GitStatusResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	found := false
	for _, f := range resp.Files {
		if f.Path == "newfile.txt" && f.Status == "U" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected newfile.txt with status U in response, got: %+v", resp.Files)
	}
}

// TestHandleFilesStatus_MissingRepo verifies 400 for unknown repo.
func TestHandleFilesStatus_MissingRepo(t *testing.T) {
	_, s := setupFilesRepo(t)

	req := httptest.NewRequest(http.MethodGet, "/api/files/status?repo=ghost", nil)
	rr := httptest.NewRecorder()
	s.handleFilesStatus(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

// ── Language detection ───────────────────────────────────────────────────────

func TestDetectLanguage(t *testing.T) {
	cases := []struct {
		filename string
		want     string
	}{
		{"main.go", "go"},
		{"app.ts", "typescript"},
		{"App.tsx", "tsx"},
		{"index.js", "javascript"},
		{"styles.css", "css"},
		{"config.yaml", "yaml"},
		{"config.yml", "yaml"},
		{"README.md", "markdown"},
		{"script.sh", "bash"},
		{"main.py", "python"},
		{"main.rs", "rust"},
		{"Makefile", "makefile"},
		{"makefile", "makefile"},
		{"Dockerfile", "dockerfile"},
		{"unknown.xyz", "text"},
	}

	for _, tc := range cases {
		got := detectLanguage(tc.filename)
		if got != tc.want {
			t.Errorf("detectLanguage(%q) = %q, want %q", tc.filename, got, tc.want)
		}
	}
}

// ── mapGitStatus ─────────────────────────────────────────────────────────────

func TestMapGitStatus(t *testing.T) {
	cases := []struct {
		xy   string
		want string
	}{
		{"??", "U"},
		{"M ", "M"},
		{" M", "M"},
		{"MM", "M"},
		{"A ", "A"},
		{"D ", "D"},
		{" D", "D"},
		{"R ", "M"},
		{"!!", ""},
	}

	for _, tc := range cases {
		got := mapGitStatus(tc.xy)
		if got != tc.want {
			t.Errorf("mapGitStatus(%q) = %q, want %q", tc.xy, got, tc.want)
		}
	}
}
