package service

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
)

// mockPublisher implements EventPublisher for testing.
type mockPublisher struct {
	mu     sync.Mutex
	events []Event
}

func (m *mockPublisher) Publish(channel string, event Event) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, event)
}

func (m *mockPublisher) Subscribe(channel string) (<-chan Event, func()) {
	ch := make(chan Event, 100)
	return ch, func() { close(ch) }
}

func (m *mockPublisher) getEvents() []Event {
	m.mu.Lock()
	defer m.mu.Unlock()
	copied := make([]Event, len(m.events))
	copy(copied, m.events)
	return copied
}

func TestRunTracker_TryStart(t *testing.T) {
	tracker := &RunTracker{}

	// First call should succeed
	if !tracker.TryStart("test-key") {
		t.Fatal("expected TryStart to return true on first call")
	}

	// Second call with same key should fail
	if tracker.TryStart("test-key") {
		t.Fatal("expected TryStart to return false when key is already running")
	}

	// Different key should succeed
	if !tracker.TryStart("other-key") {
		t.Fatal("expected TryStart to return true for different key")
	}

	// IsRunning should report true
	if !tracker.IsRunning("test-key") {
		t.Fatal("expected IsRunning to return true for running key")
	}

	// After Done, should be able to start again
	tracker.Done("test-key")
	if tracker.IsRunning("test-key") {
		t.Fatal("expected IsRunning to return false after Done")
	}
	if !tracker.TryStart("test-key") {
		t.Fatal("expected TryStart to return true after Done")
	}

	// Cleanup
	tracker.Done("test-key")
	tracker.Done("other-key")
}

func TestMergeWave_ConcurrentGuard(t *testing.T) {
	// Reset the global tracker for test isolation
	origTracker := MergeTracker
	MergeTracker = &RunTracker{}
	defer func() { MergeTracker = origTracker }()

	// Replace MergeFunc with a slow no-op to hold the lock
	origMergeFunc := MergeFunc
	defer func() { MergeFunc = origMergeFunc }()

	started := make(chan struct{})
	block := make(chan struct{})
	MergeFunc = func(_ context.Context, _ engine.RunMergeOpts) error {
		// Signal that we've started, then block
		close(started)
		<-block
		return nil
	}

	pub := &mockPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/test-repo",
		IMPLDir:   "/tmp/test-impl",
		Publisher: pub,
	}

	// First merge should succeed (returns nil)
	err := MergeWave(deps, "test-slug", 1, "/tmp/impl.yaml", "/tmp/test-repo")
	if err != nil {
		t.Fatalf("expected first MergeWave to succeed, got: %v", err)
	}

	// Wait for the goroutine to actually start and acquire the lock
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for merge goroutine to start")
	}

	// Second merge for same slug should fail with concurrent guard
	err = MergeWave(deps, "test-slug", 2, "/tmp/impl.yaml", "/tmp/test-repo")
	if err == nil {
		t.Fatal("expected second MergeWave to fail with concurrent guard")
	}
	if err.Error() != `merge already in progress for slug "test-slug"` {
		t.Fatalf("unexpected error: %v", err)
	}

	// Unblock and cleanup
	close(block)
	// Give goroutine time to finish
	time.Sleep(100 * time.Millisecond)
}

func TestAbortMerge_NotRunning(t *testing.T) {
	// AbortMerge on a non-existent repo should fail with git error
	pub := &mockPublisher{}
	deps := Deps{
		RepoPath: "/tmp/nonexistent-repo-for-test",
		Publisher: pub,
	}

	err := AbortMerge(deps, "test-slug", "/tmp/nonexistent-repo-for-test")
	if err == nil {
		t.Fatal("expected AbortMerge to fail on nonexistent repo")
	}
	// Should contain git error
	if err.Error() == "" {
		t.Fatal("expected non-empty error message")
	}
}

func TestExtractConflictingFiles(t *testing.T) {
	errStr := `Merging branch 'feature' into main
CONFLICT (content): Merge conflict in pkg/api/server.go
CONFLICT (content): Merge conflict in pkg/api/handlers.go
Auto-merging pkg/util/helper.go`

	files := extractConflictingFiles(errStr)
	if len(files) != 2 {
		t.Fatalf("expected 2 conflicting files, got %d: %v", len(files), files)
	}
	if files[0] != "pkg/api/server.go" {
		t.Errorf("expected first file to be pkg/api/server.go, got %s", files[0])
	}
	if files[1] != "pkg/api/handlers.go" {
		t.Errorf("expected second file to be pkg/api/handlers.go, got %s", files[1])
	}
}

func TestExtractConflictingFiles_NoConflicts(t *testing.T) {
	files := extractConflictingFiles("everything merged cleanly")
	if len(files) != 0 {
		t.Fatalf("expected 0 conflicting files, got %d", len(files))
	}
}
