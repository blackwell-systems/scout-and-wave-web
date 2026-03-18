package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// waveAgentBranchRe matches SAW-managed branches in both legacy format
// ("wave1-agent-A") and slug-scoped format ("saw/my-slug/wave1-agent-A").
var waveAgentBranchRe = regexp.MustCompile(`^(?:saw/[a-z0-9][-a-z0-9]*/)?wave\d+-agent-[A-Z][2-9]?$`)

// handleListWorktrees serves GET /api/impl/{slug}/worktrees.
// Parses `git worktree list --porcelain` output, filters to SAW-managed
// branches, checks merged status, and returns WorktreeListResponse JSON.
func (s *Server) handleListWorktrees(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	// Resolve the repository path from the IMPL doc location
	_, repoPath, err := s.resolveIMPLPath(slug)
	if err != nil {
		http.Error(w, "IMPL doc not found", http.StatusNotFound)
		return
	}

	// Run git worktree list --porcelain
	cmd := exec.Command("git", "worktree", "list", "--porcelain")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		http.Error(w, "failed to list worktrees", http.StatusInternalServerError)
		return
	}

	// Get the set of branches merged into main
	mergedBranches := getMergedBranches(repoPath)

	// Parse porcelain output into worktree entries
	worktrees := parseWorktreePorcelain(out, mergedBranches)

	// Enrich each entry with HasUnsaved, LastCommitAge, and stale detection
	enrichWorktreeEntries(worktrees)

	resp := WorktreeListResponse{Worktrees: worktrees}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

// handleDeleteWorktree serves DELETE /api/impl/{slug}/worktrees/{branch}.
// Removes the git worktree and deletes the branch. Returns 409 if the branch
// is unmerged and the "force" query param is not set.
func (s *Server) handleDeleteWorktree(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	branch := r.PathValue("branch")
	if branch == "" {
		http.Error(w, "missing branch", http.StatusBadRequest)
		return
	}

	// Resolve the repository path from the IMPL doc location
	_, repoPath, err := s.resolveIMPLPath(slug)
	if err != nil {
		http.Error(w, "IMPL doc not found", http.StatusNotFound)
		return
	}

	force := r.URL.Query().Get("force") == "true"

	// Check if branch is merged before potentially removing
	mergedBranches := getMergedBranches(repoPath)
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
	worktreePath := findWorktreePath(repoPath, branch)
	if worktreePath != "" {
		// Remove the worktree
		rmCmd := exec.Command("git", "worktree", "remove", "--force", worktreePath)
		rmCmd.Dir = repoPath
		rmCmd.Run() //nolint:errcheck — best effort; branch delete follows
	}

	// Delete the branch
	delCmd := exec.Command("git", "branch", "-d", branch)
	delCmd.Dir = repoPath
	if err := delCmd.Run(); err != nil {
		// Try force-delete if soft delete fails (e.g. worktree already removed)
		forceDelCmd := exec.Command("git", "branch", "-D", branch)
		forceDelCmd.Dir = repoPath
		if err2 := forceDelCmd.Run(); err2 != nil {
			http.Error(w, "failed to delete branch", http.StatusInternalServerError)
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

// handleBatchDeleteWorktrees serves POST /api/impl/{slug}/worktrees/cleanup.
// Accepts a JSON body with branches to delete and a force flag.
// When force=false and any branch is unmerged, returns 409 with the list.
// When force=true (or all are merged), deletes each worktree+branch.
func (s *Server) handleBatchDeleteWorktrees(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	var req WorktreeBatchDeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if len(req.Branches) == 0 {
		http.Error(w, "branches list is empty", http.StatusBadRequest)
		return
	}

	// Resolve the repository path from the IMPL doc location
	_, repoPath, err := s.resolveIMPLPath(slug)
	if err != nil {
		http.Error(w, "IMPL doc not found", http.StatusNotFound)
		return
	}

	mergedBranches := getMergedBranches(repoPath)

	// When force=false, check for unmerged branches first
	if !req.Force {
		var unmerged []string
		for _, branch := range req.Branches {
			if !mergedBranches[branch] {
				unmerged = append(unmerged, branch)
			}
		}
		if len(unmerged) > 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
				"error":    "unmerged branches exist",
				"unmerged": unmerged,
			})
			return
		}
	}

	// Delete each branch
	var results []WorktreeBatchDeleteResult
	deletedCount := 0
	failedCount := 0

	for _, branch := range req.Branches {
		result := WorktreeBatchDeleteResult{Branch: branch}

		// Find and remove worktree
		worktreePath := findWorktreePath(repoPath, branch)
		if worktreePath != "" {
			rmCmd := exec.Command("git", "worktree", "remove", "--force", worktreePath)
			rmCmd.Dir = repoPath
			rmCmd.Run() //nolint:errcheck — best effort
		}

		// Delete the branch
		delCmd := exec.Command("git", "branch", "-d", branch)
		delCmd.Dir = repoPath
		if err := delCmd.Run(); err != nil {
			// Try force-delete
			forceDelCmd := exec.Command("git", "branch", "-D", branch)
			forceDelCmd.Dir = repoPath
			if err2 := forceDelCmd.Run(); err2 != nil {
				result.Deleted = false
				result.Error = "failed to delete branch"
				failedCount++
				results = append(results, result)
				continue
			}
		}

		result.Deleted = true
		deletedCount++
		results = append(results, result)
	}

	resp := WorktreeBatchDeleteResponse{
		Results:      results,
		DeletedCount: deletedCount,
		FailedCount:  failedCount,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
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

// enrichWorktreeEntries populates HasUnsaved, LastCommitAge, and stale status
// for each worktree entry by running git commands against their paths.
func enrichWorktreeEntries(entries []WorktreeEntry) {
	now := time.Now().Unix()
	staleThreshold := int64(24 * 60 * 60) // 24 hours in seconds

	for i := range entries {
		path := entries[i].Path

		// Check for unsaved changes
		statusCmd := exec.Command("git", "-C", path, "status", "--porcelain")
		if statusOut, err := statusCmd.Output(); err == nil {
			entries[i].HasUnsaved = len(bytes.TrimSpace(statusOut)) > 0
		}

		// Get last commit relative age (human-readable)
		ageCmd := exec.Command("git", "-C", path, "log", "-1", "--format=%cr")
		if ageOut, err := ageCmd.Output(); err == nil {
			entries[i].LastCommitAge = strings.TrimSpace(string(ageOut))
		}

		// Stale detection: unmerged AND last commit > 24 hours old
		if entries[i].Status == "unmerged" {
			tsCmd := exec.Command("git", "-C", path, "log", "-1", "--format=%ct")
			if tsOut, err := tsCmd.Output(); err == nil {
				if ts, err := strconv.ParseInt(strings.TrimSpace(string(tsOut)), 10, 64); err == nil {
					if now-ts > staleThreshold {
						entries[i].Status = "stale"
					}
				}
			}
		}
	}
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

// detectStaleBranches returns the names of SAW-managed branches that exist
// locally but are not merged into main. It reuses parseWorktreePorcelain and
// getMergedBranches so the logic stays consistent with handleListWorktrees.
// Called by wave_runner.go before each run to emit an advisory SSE event.
func detectStaleBranches(repoPath string) []string {
	cmd := exec.Command("git", "worktree", "list", "--porcelain")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		// Also check plain branch list (worktrees may have been removed
		// but branches still exist).
		return detectStaleBranchesFromRefs(repoPath)
	}

	mergedBranches := getMergedBranches(repoPath)
	entries := parseWorktreePorcelain(out, mergedBranches)

	var stale []string
	for _, e := range entries {
		if e.Status == "unmerged" || e.Status == "stale" {
			stale = append(stale, e.Branch)
		}
	}

	// Also pick up orphaned branches (no worktree but branch ref exists)
	refStale := detectStaleBranchesFromRefs(repoPath)
	seen := make(map[string]bool, len(stale))
	for _, b := range stale {
		seen[b] = true
	}
	for _, b := range refStale {
		if !seen[b] {
			stale = append(stale, b)
		}
	}

	return stale
}

// detectStaleBranchesFromRefs lists local SAW-pattern branches that are not
// merged into main. This catches branches whose worktrees have already been
// removed.
func detectStaleBranchesFromRefs(repoPath string) []string {
	cmd := exec.Command("git", "branch", "--no-merged", "main")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return nil
	}

	mergedBranches := getMergedBranches(repoPath)
	var stale []string
	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		branch := strings.TrimSpace(strings.TrimPrefix(scanner.Text(), "*"))
		if branch != "" && waveAgentBranchRe.MatchString(branch) && !mergedBranches[branch] {
			stale = append(stale, branch)
		}
	}
	return stale
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
