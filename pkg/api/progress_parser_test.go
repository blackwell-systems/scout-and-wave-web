package api

import (
	"sync"
	"testing"
)

// testBrokerCollector captures SSE events published to a broker for testing.
type testBrokerCollector struct {
	mu     sync.Mutex
	events []SSEEvent
}

func (c *testBrokerCollector) collect(ev SSEEvent) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.events = append(c.events, ev)
}

func (c *testBrokerCollector) getEvents() []SSEEvent {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]SSEEvent, len(c.events))
	copy(out, c.events)
	return out
}

// newTestServer builds a minimal Server with a real broker and progress tracker,
// wired so we can capture published events without real HTTP.
func newTestServer() (*Server, *testBrokerCollector) {
	collector := &testBrokerCollector{}

	broker := &sseBroker{
		clients: make(map[string][]chan SSEEvent),
	}

	s := &Server{
		broker:          broker,
		progressTracker: NewProgressTracker(),
	}

	return s, collector
}

// publishAndCollect publishes a SSEEvent to the broker and subscribes to capture the result.
// Returns the collected events from the broker for the given slug.
func publishAndCollect(s *Server, slug string, ev SSEEvent) []SSEEvent {
	ch := s.broker.subscribe(slug)
	defer s.broker.unsubscribe(slug, ch)

	// Call ParseAndEmitProgress directly (not via broker subscription)
	s.ParseAndEmitProgress(ev, slug)

	// Drain everything from channel without blocking
	var events []SSEEvent
	for {
		select {
		case e := <-ch:
			events = append(events, e)
		default:
			return events
		}
	}
}

// TestParseAndEmitProgress_WriteTool verifies that a Write tool call emits
// an agent_progress event with the correct current_file and current_action.
func TestParseAndEmitProgress_WriteTool(t *testing.T) {
	s, _ := newTestServer()
	slug := "test-write"

	// Pre-populate filesOwnedCache so we don't need a real IMPL doc
	cacheKey := "test-write/1/A"
	s.filesOwnedCache.Store(cacheKey, []string{"pkg/foo/foo.go", "pkg/bar/bar.go"})

	ev := SSEEvent{
		Event: "agent_tool_call",
		Data: AgentToolCallPayload{
			Agent:    "A",
			Wave:     1,
			ToolName: "Write",
			Input:    `{"file_path":"pkg/foo/foo.go","content":"package foo\n"}`,
			IsResult: false,
		},
	}

	events := publishAndCollect(s, slug, ev)

	if len(events) != 1 {
		t.Fatalf("expected 1 agent_progress event, got %d: %+v", len(events), events)
	}

	got := events[0]
	if got.Event != "agent_progress" {
		t.Errorf("expected event='agent_progress', got %q", got.Event)
	}

	payload, ok := got.Data.(AgentProgressPayload)
	if !ok {
		t.Fatalf("expected Data to be AgentProgressPayload, got %T", got.Data)
	}

	if payload.CurrentFile != "pkg/foo/foo.go" {
		t.Errorf("expected CurrentFile='pkg/foo/foo.go', got %q", payload.CurrentFile)
	}
	if payload.CurrentAction != "Writing pkg/foo/foo.go" {
		t.Errorf("expected CurrentAction='Writing pkg/foo/foo.go', got %q", payload.CurrentAction)
	}
	if payload.Agent != "A" {
		t.Errorf("expected Agent='A', got %q", payload.Agent)
	}
	if payload.Wave != 1 {
		t.Errorf("expected Wave=1, got %d", payload.Wave)
	}
}

// TestParseAndEmitProgress_BashTool verifies that a Bash tool call emits
// an agent_progress event with a command snippet (max 50 chars) in current_action.
func TestParseAndEmitProgress_BashTool(t *testing.T) {
	s, _ := newTestServer()
	slug := "test-bash"

	// Pre-populate filesOwnedCache
	cacheKey := "test-bash/1/B"
	s.filesOwnedCache.Store(cacheKey, []string{"pkg/api/server.go"})

	longCmd := "go test ./pkg/api/... -v -run TestSomethingVeryLongAndDetailed"
	ev := SSEEvent{
		Event: "agent_tool_call",
		Data: AgentToolCallPayload{
			Agent:    "B",
			Wave:     1,
			ToolName: "Bash",
			Input:    `{"command":"` + longCmd + `"}`,
			IsResult: false,
		},
	}

	events := publishAndCollect(s, slug, ev)

	if len(events) != 1 {
		t.Fatalf("expected 1 agent_progress event, got %d", len(events))
	}

	payload, ok := events[0].Data.(AgentProgressPayload)
	if !ok {
		t.Fatalf("expected AgentProgressPayload, got %T", events[0].Data)
	}

	expectedSnippet := longCmd[:50]
	expectedAction := "Running " + expectedSnippet
	if payload.CurrentAction != expectedAction {
		t.Errorf("expected CurrentAction=%q, got %q", expectedAction, payload.CurrentAction)
	}

	// current_file should be empty for Bash tool
	if payload.CurrentFile != "" {
		t.Errorf("expected CurrentFile='', got %q", payload.CurrentFile)
	}
}

// TestParseAndEmitProgress_GitCommit verifies that a "git commit" Bash command
// increments the commitsMade counter, which is reflected in PercentDone.
func TestParseAndEmitProgress_GitCommit(t *testing.T) {
	s, _ := newTestServer()
	slug := "test-gitcommit"

	// Pre-populate filesOwnedCache with 2 files
	cacheKey := "test-gitcommit/1/A"
	s.filesOwnedCache.Store(cacheKey, []string{"pkg/a/a.go", "pkg/b/b.go"})

	makeCommitEv := func() SSEEvent {
		return SSEEvent{
			Event: "agent_tool_call",
			Data: AgentToolCallPayload{
				Agent:    "A",
				Wave:     1,
				ToolName: "Bash",
				Input:    `{"command":"git commit -m 'feat: add stuff'"}`,
				IsResult: false,
			},
		}
	}

	// First git commit
	publishAndCollect(s, slug, makeCommitEv())

	key := "test-gitcommit/1/A"
	val, ok := s.commitCounts.Load(key)
	if !ok || val.(int) != 1 {
		t.Errorf("expected commitCounts[%s]=1 after first git commit, got %v", key, val)
	}

	// Second git commit
	publishAndCollect(s, slug, makeCommitEv())

	val, ok = s.commitCounts.Load(key)
	if !ok || val.(int) != 2 {
		t.Errorf("expected commitCounts[%s]=2 after second git commit, got %v", key, val)
	}
}

// TestParseAndEmitProgress_IgnoreResults verifies that events with IsResult=true
// are silently skipped (no agent_progress emitted).
func TestParseAndEmitProgress_IgnoreResults(t *testing.T) {
	s, _ := newTestServer()
	slug := "test-ignore"

	ev := SSEEvent{
		Event: "agent_tool_call",
		Data: AgentToolCallPayload{
			Agent:    "A",
			Wave:     1,
			ToolName: "Write",
			Input:    `{"file_path":"foo.go"}`,
			IsResult: true, // This is a result — should be ignored
		},
	}

	events := publishAndCollect(s, slug, ev)

	if len(events) != 0 {
		t.Errorf("expected 0 events for IsResult=true, got %d: %+v", len(events), events)
	}
}

// TestParseAndEmitProgress_PercentDone verifies that PercentDone is calculated
// correctly: commitsMade / len(filesOwned) * 100.
// E.g. 1 commit / 2 files = 50%.
func TestParseAndEmitProgress_PercentDone(t *testing.T) {
	s, _ := newTestServer()
	slug := "test-percent"

	// Pre-populate filesOwnedCache with 2 files
	cacheKey := "test-percent/1/A"
	s.filesOwnedCache.Store(cacheKey, []string{"file1.go", "file2.go"})

	// Emit 1 git commit
	ev := SSEEvent{
		Event: "agent_tool_call",
		Data: AgentToolCallPayload{
			Agent:    "A",
			Wave:     1,
			ToolName: "Bash",
			Input:    `{"command":"git commit -m 'first'"}`,
			IsResult: false,
		},
	}

	events := publishAndCollect(s, slug, ev)

	if len(events) != 1 {
		t.Fatalf("expected 1 agent_progress event, got %d", len(events))
	}

	payload, ok := events[0].Data.(AgentProgressPayload)
	if !ok {
		t.Fatalf("expected AgentProgressPayload, got %T", events[0].Data)
	}

	// 1 commit / 2 files = 50%
	if payload.PercentDone != 50 {
		t.Errorf("expected PercentDone=50, got %d", payload.PercentDone)
	}
}
