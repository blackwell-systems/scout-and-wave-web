package api

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// DiskAgentStatus represents one agent's status reconstructed from disk.
type DiskAgentStatus struct {
	Agent       string   `json:"agent"`
	Wave        int      `json:"wave"`
	Status      string   `json:"status"` // "complete", "partial", "blocked", "failed", "pending"
	Branch      string   `json:"branch,omitempty"`
	Commit      string   `json:"commit,omitempty"`
	Files       []string `json:"files,omitempty"`
	FailureType string   `json:"failure_type,omitempty"`
	Message     string   `json:"message,omitempty"`
}

// DiskWaveStatus is the response for GET /api/wave/{slug}/disk-status.
type DiskWaveStatus struct {
	Slug           string            `json:"slug"`
	CurrentWave    int               `json:"current_wave"`
	TotalWaves     int               `json:"total_waves"`
	ScaffoldStatus string            `json:"scaffold_status"` // "none", "pending", "committed"
	Agents         []DiskAgentStatus `json:"agents"`
	WavesMerged    []int             `json:"waves_merged"` // wave numbers already merged into current branch
}

// handleWaveDiskStatus serves GET /api/wave/{slug}/disk-status.
// Reconstructs wave/agent state from the IMPL doc on disk + git branches.
// Survives server restarts — no in-memory state required.
func (s *Server) handleWaveDiskStatus(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	implPath, repoPath, err := s.resolveIMPLPath(slug)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	manifest, err := protocol.Load(implPath)
	if err != nil {
		http.Error(w, "failed to load manifest: "+err.Error(), http.StatusInternalServerError)
		return
	}

	result := DiskWaveStatus{
		Slug:       slug,
		TotalWaves: len(manifest.Waves),
	}

	// Scaffold status
	if len(manifest.Scaffolds) == 0 {
		result.ScaffoldStatus = "none"
	} else {
		allCommitted := true
		for _, sc := range manifest.Scaffolds {
			if !strings.HasPrefix(sc.Status, "committed") {
				allCommitted = false
				break
			}
		}
		if allCommitted {
			result.ScaffoldStatus = "committed"
		} else {
			result.ScaffoldStatus = "pending"
		}
	}

	// Current wave
	cw := protocol.CurrentWave(manifest)
	if cw != nil {
		result.CurrentWave = cw.Number
	} else if len(manifest.Waves) > 0 {
		result.CurrentWave = manifest.Waves[len(manifest.Waves)-1].Number
	}

	// Build agent statuses from completion reports + git state
	for _, wave := range manifest.Waves {
		for _, agent := range wave.Agents {
			branch := protocol.BranchName(manifest.FeatureSlug, wave.Number, agent.ID)
			legacyBranch := protocol.LegacyBranchName(wave.Number, agent.ID)
			ds := DiskAgentStatus{
				Agent:  agent.ID,
				Wave:   wave.Number,
				Files:  agent.Files,
				Branch: branch,
			}

			if report, ok := manifest.CompletionReports[agent.ID]; ok {
				ds.Status = report.Status
				ds.Commit = report.Commit
				if report.Branch != "" {
					ds.Branch = report.Branch
				}
				ds.FailureType = report.FailureType
				ds.Message = report.Notes
			} else {
				// Check slug-scoped branch first, fall back to legacy
				hasCommits := diskBranchHasCommits(repoPath, branch) || diskBranchHasCommits(repoPath, legacyBranch)
				wtPath := protocol.WorktreeDir(repoPath, manifest.FeatureSlug, wave.Number, agent.ID)
				_, wtErr := os.Stat(wtPath)
				hasWorktree := wtErr == nil
				if !hasWorktree {
					// Fallback: check legacy worktree path
					legacyWtPath := filepath.Join(repoPath, ".claude", "worktrees", legacyBranch)
					_, wtErr = os.Stat(legacyWtPath)
					hasWorktree = wtErr == nil
				}

				if hasCommits {
					ds.Status = "complete"
					// Try slug-scoped branch first, fall back to legacy
					commit := diskBranchHead(repoPath, branch)
					if commit == "" {
						commit = diskBranchHead(repoPath, legacyBranch)
					}
					ds.Commit = commit
				} else if hasWorktree {
					ds.Status = "failed"
					ds.Message = "worktree exists but no implementation commits"
				} else {
					ds.Status = "pending"
				}
			}

			result.Agents = append(result.Agents, ds)
		}
	}

	// Detect which waves have been fully merged into the current branch.
	// A wave is considered merged only if ALL agents have completion reports
	// with status "complete" AND their branches are either ancestors of HEAD
	// or already cleaned up. A completion report is required to prevent
	// stale branches from prior IMPLs (same agent ID) being misattributed.
	for _, wave := range manifest.Waves {
		allMerged := true
		for _, agent := range wave.Agents {
			report, hasReport := manifest.CompletionReports[agent.ID]
			if !hasReport || report.Status != "complete" {
				allMerged = false
				break
			}
			// Agent has a completion report — verify branch state is consistent
			branch := protocol.BranchName(manifest.FeatureSlug, wave.Number, agent.ID)
			legacyBranch := protocol.LegacyBranchName(wave.Number, agent.ID)
			branchExists := diskBranchExists(repoPath, branch) || diskBranchExists(repoPath, legacyBranch)
			branchMerged := diskBranchMerged(repoPath, branch) || diskBranchMerged(repoPath, legacyBranch)
			if branchExists && !branchMerged {
				// Branch exists but hasn't been merged yet
				allMerged = false
				break
			}
			// Branch merged (ancestor of HEAD) or cleaned up — both OK
		}
		if allMerged && len(wave.Agents) > 0 {
			result.WavesMerged = append(result.WavesMerged, wave.Number)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result) //nolint:errcheck
}

// diskBranchHasCommits checks if a branch has non-scaffold commits beyond HEAD.
// Uses HEAD as the base (not main) because wave branches are created from the
// current HEAD, which may be ahead of main after prior wave merges. Comparing
// against main would falsely count those prior merge commits as branch work.
func diskBranchHasCommits(repoPath, branch string) bool {
	cmd := exec.Command("git", "log", "HEAD.."+branch, "--oneline")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if line == "" {
			continue
		}
		if !strings.Contains(strings.ToLower(line), "scaffold") {
			return true
		}
	}
	return false
}

// diskBranchExists returns true if the branch ref exists locally.
func diskBranchExists(repoPath, branch string) bool {
	cmd := exec.Command("git", "rev-parse", "--verify", "refs/heads/"+branch)
	cmd.Dir = repoPath
	return cmd.Run() == nil
}

// diskBranchMerged returns true if the branch has been merged into HEAD.
// A branch is considered merged only if it is an ancestor of HEAD AND has
// commits beyond its merge-base with HEAD (i.e., it had actual work that was
// merged). A branch sitting at HEAD with no unique commits is not "merged work".
func diskBranchMerged(repoPath, branch string) bool {
	// Check ancestor
	cmd := exec.Command("git", "merge-base", "--is-ancestor", branch, "HEAD")
	cmd.Dir = repoPath
	if cmd.Run() != nil {
		return false
	}
	// Verify branch has unique commits that were merged (branch is behind HEAD,
	// not exactly at HEAD with no divergence)
	cmd2 := exec.Command("git", "log", "HEAD.."+branch, "--oneline")
	cmd2.Dir = repoPath
	// If branch is ancestor of HEAD, HEAD..branch is empty. Check branch..HEAD instead:
	// if branch is strictly behind HEAD (ancestor + not equal), it was merged.
	cmd3 := exec.Command("git", "rev-parse", branch)
	cmd3.Dir = repoPath
	branchSHA, err := cmd3.Output()
	if err != nil {
		return false
	}
	cmd4 := exec.Command("git", "rev-parse", "HEAD")
	cmd4.Dir = repoPath
	headSHA, err := cmd4.Output()
	if err != nil {
		return false
	}
	// Branch at exact same commit as HEAD = no unique work, not merged
	if strings.TrimSpace(string(branchSHA)) == strings.TrimSpace(string(headSHA)) {
		return false
	}
	// Branch is ancestor of HEAD and at a different commit = was merged
	return true
}

// diskBranchHead returns the short HEAD SHA of a branch.
func diskBranchHead(repoPath, branch string) string {
	cmd := exec.Command("git", "rev-parse", "--short", branch)
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
