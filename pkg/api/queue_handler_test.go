package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/queue"
)

// newTestServerWithRepo creates a Server whose RepoPath points to a temp dir.
func newTestServerWithRepo(t *testing.T) (*Server, string) {
	t.Helper()
	tmpDir := t.TempDir()
	cfg := Config{
		Addr:     "localhost:0",
		IMPLDir:  filepath.Join(tmpDir, "docs", "IMPL"),
		RepoPath: tmpDir,
	}
	s := &Server{
		cfg:          cfg,
		mux:          http.NewServeMux(),
		broker:       &sseBroker{clients: make(map[string][]chan SSEEvent)},
		globalBroker: newGlobalBroker(),
	}
	return s, tmpDir
}

// TestHandleListQueue_Empty verifies that listing an empty (non-existent)
// queue directory returns an empty JSON array.
func TestHandleListQueue_Empty(t *testing.T) {
	s, _ := newTestServerWithRepo(t)

	req := httptest.NewRequest(http.MethodGet, "/api/queue", nil)
	w := httptest.NewRecorder()
	s.handleListQueue(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var items []queue.Item
	if err := json.NewDecoder(w.Body).Decode(&items); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(items) != 0 {
		t.Errorf("expected empty array, got %d items", len(items))
	}
}

// TestHandleAddQueue verifies that adding a queue item creates a file on disk
// and returns 201 with the created item.
func TestHandleAddQueue(t *testing.T) {
	s, tmpDir := newTestServerWithRepo(t)

	body := `{"title":"Add dark mode","priority":10,"feature_description":"Dark mode for the UI"}`
	req := httptest.NewRequest(http.MethodPost, "/api/queue", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleAddQueue(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var item queue.Item
	if err := json.NewDecoder(w.Body).Decode(&item); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if item.Title != "Add dark mode" {
		t.Errorf("expected title 'Add dark mode', got %q", item.Title)
	}

	// Verify file was created on disk
	queueDir := filepath.Join(tmpDir, "docs", "IMPL", "queue")
	entries, err := os.ReadDir(queueDir)
	if err != nil {
		t.Fatalf("failed to read queue dir: %v", err)
	}
	if len(entries) != 1 {
		t.Errorf("expected 1 file in queue dir, got %d", len(entries))
	}
}

// TestHandleDeleteQueue verifies that creating and then deleting a queue item
// returns 204 and removes the file from disk.
func TestHandleDeleteQueue(t *testing.T) {
	s, tmpDir := newTestServerWithRepo(t)

	// First, add an item
	mgr := queue.NewManager(tmpDir)
	err := mgr.Add(queue.Item{
		Title:              "Delete me",
		Priority:           5,
		FeatureDescription: "To be deleted",
	})
	if err != nil {
		t.Fatalf("failed to add item: %v", err)
	}

	// Verify it exists
	items, _ := mgr.List()
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	slug := items[0].Slug

	// Delete it via handler
	req := httptest.NewRequest(http.MethodDelete, "/api/queue/"+slug, nil)
	req.SetPathValue("slug", slug)
	w := httptest.NewRecorder()
	s.handleDeleteQueue(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// Verify file is gone
	queueDir := filepath.Join(tmpDir, "docs", "IMPL", "queue")
	entries, err := os.ReadDir(queueDir)
	if err != nil {
		t.Fatalf("failed to read queue dir: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("expected 0 files after delete, got %d", len(entries))
	}
}

// TestHandleAddQueue_InvalidBody verifies that a malformed JSON body returns 400.
func TestHandleAddQueue_InvalidBody(t *testing.T) {
	s, _ := newTestServerWithRepo(t)

	req := httptest.NewRequest(http.MethodPost, "/api/queue", strings.NewReader("{invalid json"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.handleAddQueue(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
