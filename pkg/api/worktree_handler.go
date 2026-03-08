package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"os/exec"
	"regexp"
	"strings"
)

// waveAgentBranchRe matches SAW-managed branches like "wave1-agent-a".
var waveAgentBranchRe = regexp.MustCompile(`^wave\d+-agent-[a-z]+$`)

// handleListWorktrees serves GET /api/impl/{slug}/worktrees.
// Parses `git worktree list --porcelain` output, filters to SAW-managed
// branches, checks merged status, and returns WorktreeListResponse JSON.
func (s *Server) handleListWorktrees(w http.ResponseWriter, r *http.Request) {
	// Run git worktree list --porcelain
	cmd := exec.Command("git", "worktree", "list", "--porcelain")
	cmd.Dir = s.cfg.RepoPath
	out, err := cmd.Output()
	if err != nil {
		http.Error(w, "failed to list worktrees", http.StatusInternalServerError)
		return
	}

	// Get the set of branches merged into main
	mergedBranches := getMergedBranches(s.cfg.RepoPath)

	// Parse porcelain output into worktree entries
	worktrees := parseWorktreePorcelain(out, mergedBranches)

	resp := WorktreeListResponse{Worktrees: worktrees}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

// handleDeleteWorktree serves DELETE /api/impl/{slug}/worktrees/{branch}.
// Removes the git worktree and deletes the branch. Returns 409 if the branch
// is unmerged and the "force" query param is not set.
func (s *Server) handleDeleteWorktree(w http.ResponseWriter, r *http.Request) {
	branch := r.PathValue("branch")
	if branch == "" {
		http.Error(w, "missing branch", http.StatusBadRequest)
		return
	}

	force := r.URL.Query().Get("force") == "true"

	// Check if branch is merged before potentially removing
	mergedBranches := getMergedBranches(s.cfg.RepoPath)
	isMerged := mergedBranches[branch]

	if !isMerged && !force {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{ //nolint:errcheck
			"error":  "branch is unmerged",
			"branch": branch,
		})
		return
	}

	// Find the worktree path for this branch
	worktreePath := findWorktreePath(s.cfg.RepoPath, branch)
	if worktreePath != "" {
		// Remove the worktree
		rmCmd := exec.Command("git", "worktree", "remove", "--force", worktreePath)
		rmCmd.Dir = s.cfg.RepoPath
		rmCmd.Run() //nolint:errcheck — best effort; branch delete follows
	}

	// Delete the branch
	delCmd := exec.Command("git", "branch", "-d", branch)
	delCmd.Dir = s.cfg.RepoPath
	if err := delCmd.Run(); err != nil {
		// Try force-delete if soft delete fails (e.g. worktree already removed)
		forceDelCmd := exec.Command("git", "branch", "-D", branch)
		forceDelCmd.Dir = s.cfg.RepoPath
		if err2 := forceDelCmd.Run(); err2 != nil {
			http.Error(w, "failed to delete branch", http.StatusInternalServerError)
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

// parseWorktreePorcelain parses the output of `git worktree list --porcelain`
// and returns WorktreeEntry values for branches matching the SAW wave pattern.
func parseWorktreePorcelain(data []byte, mergedBranches map[string]bool) []WorktreeEntry {
	var entries []WorktreeEntry
	scanner := bufio.NewScanner(bytes.NewReader(data))

	var currentPath, currentBranch string

	flush := func() {
		if currentPath == "" {
			return
		}
		// Strip "refs/heads/" prefix
		branch := strings.TrimPrefix(currentBranch, "refs/heads/")
		if waveAgentBranchRe.MatchString(branch) {
			status := "unmerged"
			if mergedBranches[branch] {
				status = "merged"
			}
			entries = append(entries, WorktreeEntry{
				Branch:     branch,
				Path:       currentPath,
				Status:     status,
				HasUnsaved: false,
			})
		}
		currentPath = ""
		currentBranch = ""
	}

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			flush()
			continue
		}
		if strings.HasPrefix(line, "worktree ") {
			flush()
			currentPath = strings.TrimPrefix(line, "worktree ")
		} else if strings.HasPrefix(line, "branch ") {
			currentBranch = strings.TrimPrefix(line, "branch ")
		}
		// "HEAD <sha>" line is intentionally ignored
	}
	flush()

	if entries == nil {
		return []WorktreeEntry{}
	}
	return entries
}

// getMergedBranches returns a set of branch names merged into main.
func getMergedBranches(repoPath string) map[string]bool {
	merged := make(map[string]bool)
	cmd := exec.Command("git", "branch", "--merged", "main")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return merged
	}
	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		branch := strings.TrimSpace(strings.TrimPrefix(scanner.Text(), "*"))
		if branch != "" {
			merged[branch] = true
		}
	}
	return merged
}

// findWorktreePath returns the filesystem path for the given branch from git worktree list.
// Returns empty string if not found.
func findWorktreePath(repoPath, branch string) string {
	cmd := exec.Command("git", "worktree", "list", "--porcelain")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return ""
	}

	scanner := bufio.NewScanner(bytes.NewReader(out))
	var currentPath, currentBranch string

	check := func() string {
		b := strings.TrimPrefix(currentBranch, "refs/heads/")
		if b == branch && currentPath != "" {
			return currentPath
		}
		return ""
	}

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if p := check(); p != "" {
				return p
			}
			currentPath = ""
			currentBranch = ""
			continue
		}
		if strings.HasPrefix(line, "worktree ") {
			currentPath = strings.TrimPrefix(line, "worktree ")
		} else if strings.HasPrefix(line, "branch ") {
			currentBranch = strings.TrimPrefix(line, "branch ")
		}
	}
	if p := check(); p != "" {
		return p
	}
	return ""
}
