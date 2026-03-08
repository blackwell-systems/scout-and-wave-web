package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os/exec"
	"strconv"
	"strings"
)

// handleImplDiff serves GET /api/impl/{slug}/diff/{agent}?wave=N&file=path/to/file
// Returns a unified diff of the agent's branch changes for the given file.
func (s *Server) handleImplDiff(w http.ResponseWriter, r *http.Request) {
	agent := r.PathValue("agent")
	if agent == "" {
		http.Error(w, "missing agent", http.StatusBadRequest)
		return
	}

	// Parse wave query param (default 1)
	waveStr := r.URL.Query().Get("wave")
	wave := 1
	if waveStr != "" {
		if n, err := strconv.Atoi(waveStr); err == nil && n > 0 {
			wave = n
		}
	}

	// Parse file query param (URL-decode)
	fileEncoded := r.URL.Query().Get("file")
	if fileEncoded == "" {
		http.Error(w, "missing file query param", http.StatusBadRequest)
		return
	}
	file, err := url.QueryUnescape(fileEncoded)
	if err != nil {
		http.Error(w, "invalid file param encoding", http.StatusBadRequest)
		return
	}

	// Construct branch name: wave{N}-agent-{letter}
	branch := fmt.Sprintf("wave%d-agent-%s", wave, strings.ToLower(agent))

	// Run: git diff main...{branch} -- {file}
	diff, gitErr := runGitDiff(s.cfg.RepoPath, branch, file)
	if gitErr != nil {
		// Fallback for post-merge: git diff HEAD~1...HEAD -- {file}
		diff, _ = runGitDiffFallback(s.cfg.RepoPath, file)
	}

	resp := FileDiffResponse{
		Agent:  agent,
		File:   file,
		Branch: branch,
		Diff:   diff,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

// runGitDiff runs git diff main...{branch} -- {file} and returns the output.
// Returns an error if the command exits non-zero (e.g. branch not found).
func runGitDiff(repoPath, branch, file string) (string, error) {
	cmd := exec.Command("git", "diff", fmt.Sprintf("main...%s", branch), "--", file)
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// runGitDiffFallback runs git diff HEAD~1...HEAD -- {file} as a post-merge fallback.
func runGitDiffFallback(repoPath, file string) (string, error) {
	cmd := exec.Command("git", "diff", "HEAD~1...HEAD", "--", file)
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}
