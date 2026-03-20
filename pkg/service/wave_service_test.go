package service

import (
	"sync"
	"testing"
	"time"
)

// mockPublisher is a test double for EventPublisher that records published events.
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
	ch := make(chan Event, 10)
	return ch, func() { close(ch) }
}

func (m *mockPublisher) getEvents() []Event {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]Event, len(m.events))
	copy(cp, m.events)
	return cp
}

func TestStartWave_AlreadyRunning(t *testing.T) {
	slug := "test-already-running"

	// Simulate an already-active wave by pre-storing the slug.
	activeWaves.Store(slug, struct{}{})
	defer activeWaves.Delete(slug)

	pub := &mockPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/nonexistent",
		IMPLDir:   "/tmp/nonexistent/docs/IMPL",
		Publisher: pub,
		ConfigPath: func(repoPath string) string {
			return repoPath + "/saw.config.json"
		},
	}

	err := StartWave(deps, slug)
	if err == nil {
		t.Fatal("expected error for already-running slug, got nil")
	}
	if got := err.Error(); got != `wave already running for slug "test-already-running"` {
		t.Fatalf("unexpected error message: %s", got)
	}
}

func TestProceedGate_UnblocksChannel(t *testing.T) {
	slug := "test-proceed-gate"

	// Create a buffered gate channel and register it.
	gateCh := make(chan bool, 1)
	gateChannels.Store(slug, gateCh)
	defer gateChannels.Delete(slug)

	pub := &mockPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/nonexistent",
		Publisher: pub,
		ConfigPath: func(repoPath string) string {
			return repoPath + "/saw.config.json"
		},
	}

	err := ProceedGate(deps, slug)
	if err != nil {
		t.Fatalf("ProceedGate returned error: %v", err)
	}

	// Verify the channel received a signal.
	select {
	case val := <-gateCh:
		if !val {
			t.Fatal("expected true on gate channel, got false")
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("gate channel did not receive signal within timeout")
	}
}

func TestProceedGate_NoGatePending(t *testing.T) {
	slug := "test-no-gate"

	pub := &mockPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/nonexistent",
		Publisher: pub,
		ConfigPath: func(repoPath string) string {
			return repoPath + "/saw.config.json"
		},
	}

	err := ProceedGate(deps, slug)
	if err == nil {
		t.Fatal("expected error for no pending gate, got nil")
	}
}

func TestStartWave_PublishesRunStarted(t *testing.T) {
	// We test makePublish directly since StartWave requires a real IMPL doc.
	slug := "test-publish"
	pub := &mockPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/nonexistent",
		Publisher: pub,
		ConfigPath: func(repoPath string) string {
			return repoPath + "/saw.config.json"
		},
	}

	publish := makePublish(deps, slug)
	publish("run_started", map[string]string{"slug": slug, "impl_path": "/some/path"})

	events := pub.getEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].Name != "run_started" {
		t.Fatalf("expected event name 'run_started', got %q", events[0].Name)
	}
	if events[0].Channel != slug {
		t.Fatalf("expected channel %q, got %q", slug, events[0].Channel)
	}
}

func TestStopWave_NotRunning(t *testing.T) {
	pub := &mockPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/nonexistent",
		Publisher: pub,
		ConfigPath: func(repoPath string) string {
			return repoPath + "/saw.config.json"
		},
	}

	err := StopWave(deps, "nonexistent-slug")
	if err == nil {
		t.Fatal("expected error for non-running slug, got nil")
	}
}

func TestRerunAgent_InvalidWave(t *testing.T) {
	pub := &mockPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/nonexistent",
		Publisher: pub,
		ConfigPath: func(repoPath string) string {
			return repoPath + "/saw.config.json"
		},
	}

	err := RerunAgent(deps, "test-slug", 0, "A", "")
	if err == nil {
		t.Fatal("expected error for wave < 1, got nil")
	}
}

func TestFinalizeWave_InvalidWave(t *testing.T) {
	pub := &mockPublisher{}
	deps := Deps{
		RepoPath:  "/tmp/nonexistent",
		Publisher: pub,
		ConfigPath: func(repoPath string) string {
			return repoPath + "/saw.config.json"
		},
	}

	err := FinalizeWave(deps, "test-slug", 0)
	if err == nil {
		t.Fatal("expected error for wave < 1, got nil")
	}
}
