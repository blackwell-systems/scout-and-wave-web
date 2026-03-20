package service

import (
	"context"
	"sync"
	"testing"
	"time"
)

// mockPublisher is a test double for EventPublisher.
type mockPublisher struct {
	mu     sync.Mutex
	events []Event
}

func (m *mockPublisher) Publish(_ string, event Event) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, event)
}

func (m *mockPublisher) Subscribe(_ string) (<-chan Event, func()) {
	ch := make(chan Event, 16)
	return ch, func() { close(ch) }
}

func (m *mockPublisher) getEvents() []Event {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]Event, len(m.events))
	copy(cp, m.events)
	return cp
}

func TestStartScout_GeneratesRunID(t *testing.T) {
	pub := &mockPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/test-repo",
		IMPLDir:   "/tmp/test-repo/docs/IMPL",
		Publisher: pub,
	}

	runID, err := StartScout(deps, "add user authentication", "")
	if err != nil {
		t.Fatalf("StartScout returned error: %v", err)
	}
	if runID == "" {
		t.Fatal("expected non-empty runID")
	}

	// RunID should be a numeric timestamp string.
	if len(runID) < 10 {
		t.Errorf("runID looks too short: %q", runID)
	}

	// Calling again should produce a different runID.
	runID2, err := StartScout(deps, "another feature", "")
	if err != nil {
		t.Fatalf("second StartScout returned error: %v", err)
	}
	if runID == runID2 {
		t.Errorf("expected different runIDs, got same: %q", runID)
	}

	// Empty feature should return an error.
	_, err = StartScout(deps, "", "")
	if err == nil {
		t.Fatal("expected error for empty feature")
	}
}

func TestCancelScout_CancelsContext(t *testing.T) {
	// Use a real context so we get a context.CancelFunc (not plain func()).
	ctx, cancel := context.WithCancel(context.Background())
	scoutRuns.Store("test-run-123", cancel)
	defer scoutRuns.Delete("test-run-123")

	pub := &mockPublisher{}
	deps := Deps{Publisher: pub}

	err := CancelScout(deps, "test-run-123")
	if err != nil {
		t.Fatalf("CancelScout returned error: %v", err)
	}
	// Verify the context was actually cancelled.
	select {
	case <-ctx.Done():
		// success — context was cancelled
	default:
		t.Fatal("expected context to be cancelled")
	}

	// Cancelling a non-existent run should not error (idempotent).
	err = CancelScout(deps, "nonexistent-run")
	if err != nil {
		t.Fatalf("CancelScout for nonexistent run returned error: %v", err)
	}
}

func TestSlugify_Truncation(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		expect string
	}{
		{
			name:   "simple lowercase",
			input:  "Add User Auth",
			expect: "add-user-auth",
		},
		{
			name:   "special characters",
			input:  "Hello, World! (v2.0)",
			expect: "hello-world-v2-0",
		},
		{
			name:   "leading/trailing hyphens",
			input:  "---trimmed---",
			expect: "trimmed",
		},
		{
			name:   "truncation at 40 chars",
			input:  "this is a very long feature description that should be truncated to forty characters",
			expect: "this-is-a-very-long-feature-description-",
		},
		{
			name:   "exactly 40 chars",
			input:  "1234567890123456789012345678901234567890",
			expect: "1234567890123456789012345678901234567890",
		},
		{
			name:   "empty string",
			input:  "",
			expect: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Slugify(tt.input)
			if got != tt.expect {
				t.Errorf("Slugify(%q) = %q, want %q", tt.input, got, tt.expect)
			}
			if len(got) > 40 {
				t.Errorf("Slugify(%q) produced %d chars, exceeds 40", tt.input, len(got))
			}
		})
	}

	// Verify idempotency with timing (slugify should be fast/deterministic).
	start := time.Now()
	for i := 0; i < 1000; i++ {
		Slugify("test performance feature description")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Errorf("Slugify is unexpectedly slow: %v for 1000 iterations", elapsed)
	}
}
