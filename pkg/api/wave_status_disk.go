package api

import (
	"encoding/json"
	"fmt"
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
			branch := fmt.Sprintf("wave%d-agent-%s", wave.Number, agent.ID)
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
				hasCommits := diskBranchHasCommits(repoPath, branch)
				wtPath := filepath.Join(repoPath, ".claude", "worktrees", branch)
				_, wtErr := os.Stat(wtPath)
				hasWorktree := wtErr == nil

				if hasCommits {
					ds.Status = "complete"
					ds.Commit = diskBranchHead(repoPath, branch)
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
	for _, wave := range manifest.Waves {
		allMerged := true
		for _, agent := range wave.Agents {
			branch := fmt.Sprintf("wave%d-agent-%s", wave.Number, agent.ID)
			if !diskBranchMerged(repoPath, branch) {
				allMerged = false
				break
			}
		}
		if allMerged {
			result.WavesMerged = append(result.WavesMerged, wave.Number)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result) //nolint:errcheck
}

// diskBranchHasCommits checks if a branch has non-scaffold commits beyond main.
func diskBranchHasCommits(repoPath, branch string) bool {
	cmd := exec.Command("git", "log", "main.."+branch, "--oneline")
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

// diskBranchMerged returns true if the branch has been merged into HEAD.
// Uses `git merge-base --is-ancestor` which exits 0 if branch is an ancestor of HEAD.
func diskBranchMerged(repoPath, branch string) bool {
	cmd := exec.Command("git", "merge-base", "--is-ancestor", branch, "HEAD")
	cmd.Dir = repoPath
	return cmd.Run() == nil
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
