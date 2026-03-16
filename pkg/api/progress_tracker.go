package api

import (
	"fmt"
	"sync"
)

// ProgressTracker tracks per-agent progress during wave execution.
type ProgressTracker struct {
	mu      sync.RWMutex
	entries map[string]*AgentProgress // key: "slug/wave/agent"
}

// AgentProgress represents the current state of an agent's execution.
type AgentProgress struct {
	Agent         string   `json:"agent"`
	Wave          int      `json:"wave"`
	CurrentFile   string   `json:"current_file"`
	CurrentAction string   `json:"current_action"`
	FilesOwned    []string `json:"files_owned"`
	CommitsMade   int      `json:"commits_made"`
	PercentDone   int      `json:"percent_done"` // 0-100, based on commits_made / len(files_owned)
}

// NewProgressTracker creates an empty ProgressTracker.
func NewProgressTracker() *ProgressTracker {
	return &ProgressTracker{
		entries: make(map[string]*AgentProgress),
	}
}

// key returns the map key for a given slug/wave/agent triple.
func progressKey(slug string, wave int, agent string) string {
	return fmt.Sprintf("%s/%d/%s", slug, wave, agent)
}

// Update upserts the progress entry for slug/wave/agent and recomputes PercentDone.
// PercentDone = min(100, commitsMade * 100 / len(filesOwned)) when filesOwned is non-empty.
func (pt *ProgressTracker) Update(slug string, wave int, agent string, filesOwned []string, currentFile string, currentAction string, commitsMade int) {
	k := progressKey(slug, wave, agent)

	percentDone := 0
	if len(filesOwned) > 0 {
		percentDone = commitsMade * 100 / len(filesOwned)
		if percentDone > 100 {
			percentDone = 100
		}
	}

	pt.mu.Lock()
	defer pt.mu.Unlock()

	owned := make([]string, len(filesOwned))
	copy(owned, filesOwned)

	pt.entries[k] = &AgentProgress{
		Agent:         agent,
		Wave:          wave,
		CurrentFile:   currentFile,
		CurrentAction: currentAction,
		FilesOwned:    owned,
		CommitsMade:   commitsMade,
		PercentDone:   percentDone,
	}
}

// Get retrieves the progress entry for slug/wave/agent.
// Returns nil if no entry exists.
func (pt *ProgressTracker) Get(slug string, wave int, agent string) *AgentProgress {
	k := progressKey(slug, wave, agent)
	pt.mu.RLock()
	defer pt.mu.RUnlock()
	return pt.entries[k]
}

// GetAll returns all progress entries for a given slug.
func (pt *ProgressTracker) GetAll(slug string) []*AgentProgress {
	pt.mu.RLock()
	defer pt.mu.RUnlock()

	prefix := slug + "/"
	var result []*AgentProgress
	for k, v := range pt.entries {
		if len(k) >= len(prefix) && k[:len(prefix)] == prefix {
			cp := *v
			result = append(result, &cp)
		}
	}
	return result
}

// Clear removes all progress entries for a given slug.
func (pt *ProgressTracker) Clear(slug string) {
	pt.mu.Lock()
	defer pt.mu.Unlock()

	prefix := slug + "/"
	for k := range pt.entries {
		if len(k) >= len(prefix) && k[:len(prefix)] == prefix {
			delete(pt.entries, k)
		}
	}
}
