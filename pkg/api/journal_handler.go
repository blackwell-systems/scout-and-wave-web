package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/journal"
)

// JournalResponse wraps full journal entries
type JournalResponse struct {
	Entries []journal.ToolEntry `json:"entries"`
}

// SummaryResponse wraps context markdown
type SummaryResponse struct {
	Markdown string `json:"markdown"`
}

// CheckpointsResponse wraps checkpoint metadata list
type CheckpointsResponse struct {
	Checkpoints []journal.Checkpoint `json:"checkpoints"`
}

// RestoreRequest specifies which checkpoint to restore
type RestoreRequest struct {
	CheckpointName string `json:"checkpoint_name"`
}

// handleJournalGet returns full journal as JSON array (not JSONL)
func (s *Server) handleJournalGet(w http.ResponseWriter, r *http.Request) {
	wave := r.PathValue("wave")
	agent := r.PathValue("agent")

	if wave == "" || agent == "" {
		http.Error(w, "wave and agent path parameters required", http.StatusBadRequest)
		return
	}

	// Construct agent path: wave{N}/agent-{ID}
	agentPath := fmt.Sprintf("%s/%s", wave, agent)

	// Create observer
	obs, err := journal.NewObserver(s.cfg.RepoPath, agentPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to create observer: %v", err), http.StatusInternalServerError)
		return
	}

	// Check if journal exists
	if _, err := os.Stat(obs.IndexPath); os.IsNotExist(err) {
		http.Error(w, fmt.Sprintf("journal not found for %s", agentPath), http.StatusNotFound)
		return
	}

	// Read all entries from index.jsonl
	entries, err := readJournalEntries(obs.IndexPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to read journal: %v", err), http.StatusInternalServerError)
		return
	}

	resp := JournalResponse{
		Entries: entries,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleJournalSummary returns context.md markdown
func (s *Server) handleJournalSummary(w http.ResponseWriter, r *http.Request) {
	wave := r.PathValue("wave")
	agent := r.PathValue("agent")

	if wave == "" || agent == "" {
		http.Error(w, "wave and agent path parameters required", http.StatusBadRequest)
		return
	}

	// Construct agent path: wave{N}/agent-{ID}
	agentPath := fmt.Sprintf("%s/%s", wave, agent)

	// Create observer
	obs, err := journal.NewObserver(s.cfg.RepoPath, agentPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to create observer: %v", err), http.StatusInternalServerError)
		return
	}

	// Check if journal exists
	if _, err := os.Stat(obs.JournalDir); os.IsNotExist(err) {
		http.Error(w, fmt.Sprintf("journal not found for %s", agentPath), http.StatusNotFound)
		return
	}

	// Read entries to generate context
	entries, err := readJournalEntries(obs.IndexPath)
	if err != nil {
		// If index doesn't exist yet, return empty context
		if os.IsNotExist(err) {
			resp := SummaryResponse{
				Markdown: "## Session Context (Recovered from Tool Journal)\n\n**No tool activity recorded yet.**\n",
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
			return
		}
		http.Error(w, fmt.Sprintf("failed to read journal: %v", err), http.StatusInternalServerError)
		return
	}

	// Generate context markdown
	markdown, err := journal.GenerateContext(entries, 0) // 0 = all entries
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to generate context: %v", err), http.StatusInternalServerError)
		return
	}

	resp := SummaryResponse{
		Markdown: markdown,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleJournalCheckpoints returns list of checkpoint metadata
func (s *Server) handleJournalCheckpoints(w http.ResponseWriter, r *http.Request) {
	wave := r.PathValue("wave")
	agent := r.PathValue("agent")

	if wave == "" || agent == "" {
		http.Error(w, "wave and agent path parameters required", http.StatusBadRequest)
		return
	}

	// Construct agent path: wave{N}/agent-{ID}
	agentPath := fmt.Sprintf("%s/%s", wave, agent)

	// Create observer
	obs, err := journal.NewObserver(s.cfg.RepoPath, agentPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to create observer: %v", err), http.StatusInternalServerError)
		return
	}

	// Check if journal exists
	if _, err := os.Stat(obs.JournalDir); os.IsNotExist(err) {
		http.Error(w, fmt.Sprintf("journal not found for %s", agentPath), http.StatusNotFound)
		return
	}

	// List checkpoints
	checkpoints, err := obs.ListCheckpoints()
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to list checkpoints: %v", err), http.StatusInternalServerError)
		return
	}

	resp := CheckpointsResponse{
		Checkpoints: checkpoints,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleJournalRestore restores journal to checkpoint state
func (s *Server) handleJournalRestore(w http.ResponseWriter, r *http.Request) {
	wave := r.PathValue("wave")
	agent := r.PathValue("agent")

	if wave == "" || agent == "" {
		http.Error(w, "wave and agent path parameters required", http.StatusBadRequest)
		return
	}

	// Parse request body
	var req RestoreRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	if req.CheckpointName == "" {
		http.Error(w, "checkpoint_name is required", http.StatusBadRequest)
		return
	}

	// Validate checkpoint name (filesystem-safe)
	if strings.ContainsAny(req.CheckpointName, "/\\ ") {
		http.Error(w, "invalid checkpoint_name: must be filesystem-safe (no slashes or spaces)", http.StatusBadRequest)
		return
	}

	// Construct agent path: wave{N}/agent-{ID}
	agentPath := fmt.Sprintf("%s/%s", wave, agent)

	// Create observer
	obs, err := journal.NewObserver(s.cfg.RepoPath, agentPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to create observer: %v", err), http.StatusInternalServerError)
		return
	}

	// Check if journal exists
	if _, err := os.Stat(obs.JournalDir); os.IsNotExist(err) {
		http.Error(w, fmt.Sprintf("journal not found for %s", agentPath), http.StatusNotFound)
		return
	}

	// Restore checkpoint
	if err := obs.RestoreCheckpoint(req.CheckpointName); err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.Error(w, fmt.Sprintf("checkpoint not found: %v", err), http.StatusBadRequest)
			return
		}
		http.Error(w, fmt.Sprintf("failed to restore checkpoint: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("restored to checkpoint %q", req.CheckpointName),
	})
}

// readJournalEntries reads all tool entries from index.jsonl
func readJournalEntries(indexPath string) ([]journal.ToolEntry, error) {
	data, err := os.ReadFile(indexPath)
	if err != nil {
		return nil, err
	}

	var entries []journal.ToolEntry
	lines := strings.Split(string(data), "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var entry journal.ToolEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			// Skip malformed lines
			continue
		}

		entries = append(entries, entry)
	}

	return entries, nil
}

// Helper to construct journal path (for directory checks)
func (s *Server) getJournalPath(wave, agent string) string {
	return filepath.Join(s.cfg.RepoPath, ".saw-state", wave, agent)
}
