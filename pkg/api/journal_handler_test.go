package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/journal"
)

// setupTestJournal creates a test journal with sample data
func setupTestJournal(t *testing.T, repoPath string, agentPath string) *journal.JournalObserver {
	t.Helper()

	obs, err := journal.NewObserver(repoPath, agentPath)
	if err != nil {
		t.Fatalf("failed to create observer: %v", err)
	}

	// Create sample entries
	entries := []journal.ToolEntry{
		{
			Timestamp: time.Now().Add(-10 * time.Minute),
			Kind:      "tool_use",
			ToolName:  "Read",
			ToolUseID: "test-use-1",
			Input: map[string]interface{}{
				"file_path": "/test/file.go",
			},
		},
		{
			Timestamp: time.Now().Add(-9 * time.Minute),
			Kind:      "tool_result",
			ToolUseID: "test-use-1",
			Preview:   "package test\n\nfunc Example() {}",
		},
		{
			Timestamp: time.Now().Add(-5 * time.Minute),
			Kind:      "tool_use",
			ToolName:  "Write",
			ToolUseID: "test-use-2",
			Input: map[string]interface{}{
				"file_path": "/test/new_file.go",
				"content":   "package test",
			},
		},
	}

	// Write entries to index.jsonl
	f, err := os.OpenFile(obs.IndexPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		t.Fatalf("failed to open index: %v", err)
	}
	defer f.Close()

	encoder := json.NewEncoder(f)
	for _, entry := range entries {
		if err := encoder.Encode(entry); err != nil {
			t.Fatalf("failed to write entry: %v", err)
		}
	}

	return obs
}

func TestHandleJournalGet_ReturnsEntries(t *testing.T) {
	// Create temp directory for test repo
	tmpDir := t.TempDir()

	// Setup test journal
	setupTestJournal(t, tmpDir, "wave1/agent-A")

	// Create server
	srv := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  filepath.Join(tmpDir, "docs/IMPL"),
		RepoPath: tmpDir,
	})

	// Create request
	req := httptest.NewRequest("GET", "/api/journal/wave1/agent-A", nil)
	req.SetPathValue("wave", "wave1")
	req.SetPathValue("agent", "agent-A")

	// Record response
	w := httptest.NewRecorder()
	srv.handleJournalGet(w, req)

	// Check response
	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp JournalResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(resp.Entries) != 3 {
		t.Errorf("expected 3 entries, got %d", len(resp.Entries))
	}

	// Verify first entry
	if resp.Entries[0].ToolName != "Read" {
		t.Errorf("expected first entry to be Read, got %s", resp.Entries[0].ToolName)
	}
}

func TestHandleJournalGet_NonexistentAgent(t *testing.T) {
	tmpDir := t.TempDir()

	srv := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  filepath.Join(tmpDir, "docs/IMPL"),
		RepoPath: tmpDir,
	})

	req := httptest.NewRequest("GET", "/api/journal/wave1/agent-Z", nil)
	req.SetPathValue("wave", "wave1")
	req.SetPathValue("agent", "agent-Z")

	w := httptest.NewRecorder()
	srv.handleJournalGet(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404, got %d", w.Code)
	}

	if !strings.Contains(w.Body.String(), "journal not found") {
		t.Errorf("expected 'journal not found' error, got: %s", w.Body.String())
	}
}

func TestHandleJournalSummary_ReturnsMarkdown(t *testing.T) {
	tmpDir := t.TempDir()

	// Setup test journal
	setupTestJournal(t, tmpDir, "wave1/agent-B")

	srv := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  filepath.Join(tmpDir, "docs/IMPL"),
		RepoPath: tmpDir,
	})

	req := httptest.NewRequest("GET", "/api/journal/wave1/agent-B/summary", nil)
	req.SetPathValue("wave", "wave1")
	req.SetPathValue("agent", "agent-B")

	w := httptest.NewRecorder()
	srv.handleJournalSummary(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp SummaryResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !strings.Contains(resp.Markdown, "## Session Context") {
		t.Errorf("expected markdown to contain '## Session Context', got: %s", resp.Markdown)
	}

	if !strings.Contains(resp.Markdown, "Total tool calls") {
		t.Errorf("expected markdown to contain tool call count, got: %s", resp.Markdown)
	}
}

func TestHandleJournalCheckpoints_ReturnsList(t *testing.T) {
	tmpDir := t.TempDir()

	// Setup test journal
	obs := setupTestJournal(t, tmpDir, "wave1/agent-C")

	// Create a checkpoint
	if err := obs.Checkpoint("test-checkpoint"); err != nil {
		t.Fatalf("failed to create checkpoint: %v", err)
	}

	srv := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  filepath.Join(tmpDir, "docs/IMPL"),
		RepoPath: tmpDir,
	})

	req := httptest.NewRequest("GET", "/api/journal/wave1/agent-C/checkpoints", nil)
	req.SetPathValue("wave", "wave1")
	req.SetPathValue("agent", "agent-C")

	w := httptest.NewRecorder()
	srv.handleJournalCheckpoints(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp CheckpointsResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(resp.Checkpoints) != 1 {
		t.Errorf("expected 1 checkpoint, got %d", len(resp.Checkpoints))
	}

	if resp.Checkpoints[0].Name != "test-checkpoint" {
		t.Errorf("expected checkpoint name 'test-checkpoint', got %s", resp.Checkpoints[0].Name)
	}

	if resp.Checkpoints[0].EntryCount != 3 {
		t.Errorf("expected 3 entries in checkpoint, got %d", resp.Checkpoints[0].EntryCount)
	}
}

func TestHandleJournalRestore_Success(t *testing.T) {
	tmpDir := t.TempDir()

	// Setup test journal
	obs := setupTestJournal(t, tmpDir, "wave1/agent-D")

	// Create checkpoint
	if err := obs.Checkpoint("restore-test"); err != nil {
		t.Fatalf("failed to create checkpoint: %v", err)
	}

	// Add more entries after checkpoint
	newEntry := journal.ToolEntry{
		Timestamp: time.Now(),
		Kind:      "tool_use",
		ToolName:  "Bash",
		ToolUseID: "test-use-after",
	}

	f, err := os.OpenFile(obs.IndexPath, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		t.Fatalf("failed to open index: %v", err)
	}
	json.NewEncoder(f).Encode(newEntry)
	f.Close()

	srv := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  filepath.Join(tmpDir, "docs/IMPL"),
		RepoPath: tmpDir,
	})

	// Restore checkpoint
	body := bytes.NewBufferString(`{"checkpoint_name":"restore-test"}`)
	req := httptest.NewRequest("POST", "/api/journal/wave1/agent-D/restore", body)
	req.SetPathValue("wave", "wave1")
	req.SetPathValue("agent", "agent-D")
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	srv.handleJournalRestore(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	// Verify journal was restored (should have 3 entries, not 4)
	entries, err := readJournalEntries(obs.IndexPath)
	if err != nil {
		t.Fatalf("failed to read entries after restore: %v", err)
	}

	if len(entries) != 3 {
		t.Errorf("expected 3 entries after restore, got %d", len(entries))
	}
}

func TestHandleJournalRestore_InvalidCheckpoint(t *testing.T) {
	tmpDir := t.TempDir()

	// Setup test journal
	setupTestJournal(t, tmpDir, "wave1/agent-E")

	srv := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  filepath.Join(tmpDir, "docs/IMPL"),
		RepoPath: tmpDir,
	})

	body := bytes.NewBufferString(`{"checkpoint_name":"nonexistent"}`)
	req := httptest.NewRequest("POST", "/api/journal/wave1/agent-E/restore", body)
	req.SetPathValue("wave", "wave1")
	req.SetPathValue("agent", "agent-E")
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	srv.handleJournalRestore(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}

	if !strings.Contains(w.Body.String(), "checkpoint not found") {
		t.Errorf("expected 'checkpoint not found' error, got: %s", w.Body.String())
	}
}

func TestHandleJournalRestore_MissingName(t *testing.T) {
	tmpDir := t.TempDir()

	// Setup test journal
	setupTestJournal(t, tmpDir, "wave1/agent-F")

	srv := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  filepath.Join(tmpDir, "docs/IMPL"),
		RepoPath: tmpDir,
	})

	body := bytes.NewBufferString(`{}`)
	req := httptest.NewRequest("POST", "/api/journal/wave1/agent-F/restore", body)
	req.SetPathValue("wave", "wave1")
	req.SetPathValue("agent", "agent-F")
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	srv.handleJournalRestore(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}

	if !strings.Contains(w.Body.String(), "checkpoint_name is required") {
		t.Errorf("expected 'checkpoint_name is required' error, got: %s", w.Body.String())
	}
}

func TestHandleJournalGet_MissingParameters(t *testing.T) {
	tmpDir := t.TempDir()

	srv := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  filepath.Join(tmpDir, "docs/IMPL"),
		RepoPath: tmpDir,
	})

	req := httptest.NewRequest("GET", "/api/journal/wave1/", nil)
	req.SetPathValue("wave", "wave1")
	// agent not set

	w := httptest.NewRecorder()
	srv.handleJournalGet(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}
}

func TestHandleJournalSummary_EmptyJournal(t *testing.T) {
	tmpDir := t.TempDir()

	// Create observer but don't add entries
	_, err := journal.NewObserver(tmpDir, "wave1/agent-G")
	if err != nil {
		t.Fatalf("failed to create observer: %v", err)
	}

	srv := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  filepath.Join(tmpDir, "docs/IMPL"),
		RepoPath: tmpDir,
	})

	req := httptest.NewRequest("GET", "/api/journal/wave1/agent-G/summary", nil)
	req.SetPathValue("wave", "wave1")
	req.SetPathValue("agent", "agent-G")

	w := httptest.NewRecorder()
	srv.handleJournalSummary(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp SummaryResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !strings.Contains(resp.Markdown, "No tool activity recorded yet") {
		t.Errorf("expected empty journal message, got: %s", resp.Markdown)
	}
}

func TestHandleJournalCheckpoints_EmptyList(t *testing.T) {
	tmpDir := t.TempDir()

	// Create journal but no checkpoints
	_, err := journal.NewObserver(tmpDir, "wave1/agent-H")
	if err != nil {
		t.Fatalf("failed to create observer: %v", err)
	}

	srv := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  filepath.Join(tmpDir, "docs/IMPL"),
		RepoPath: tmpDir,
	})

	req := httptest.NewRequest("GET", "/api/journal/wave1/agent-H/checkpoints", nil)
	req.SetPathValue("wave", "wave1")
	req.SetPathValue("agent", "agent-H")

	w := httptest.NewRecorder()
	srv.handleJournalCheckpoints(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp CheckpointsResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(resp.Checkpoints) != 0 {
		t.Errorf("expected 0 checkpoints, got %d", len(resp.Checkpoints))
	}
}

func TestHandleJournalRestore_InvalidCheckpointName(t *testing.T) {
	tmpDir := t.TempDir()

	// Setup test journal
	setupTestJournal(t, tmpDir, "wave1/agent-I")

	srv := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  filepath.Join(tmpDir, "docs/IMPL"),
		RepoPath: tmpDir,
	})

	// Try to restore with invalid checkpoint name (contains slash)
	body := bytes.NewBufferString(`{"checkpoint_name":"invalid/checkpoint"}`)
	req := httptest.NewRequest("POST", "/api/journal/wave1/agent-I/restore", body)
	req.SetPathValue("wave", "wave1")
	req.SetPathValue("agent", "agent-I")
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	srv.handleJournalRestore(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}

	if !strings.Contains(w.Body.String(), "filesystem-safe") {
		t.Errorf("expected filesystem-safe error, got: %s", w.Body.String())
	}
}
