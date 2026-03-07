package api

import (
	"bufio"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// makeTestServer creates a Server with a temporary IMPLDir for testing.
func makeTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	dir := t.TempDir()
	s := New(Config{
		Addr:     "localhost:0",
		IMPLDir:  dir,
		RepoPath: dir,
	})
	return s, dir
}

// writeIMPLDoc writes a minimal valid IMPL markdown file to dir/IMPL-{slug}.md.
func writeIMPLDoc(t *testing.T, dir, slug, content string) string {
	t.Helper()
	path := filepath.Join(dir, "IMPL-"+slug+".md")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("writeIMPLDoc: %v", err)
	}
	return path
}

const minimalIMPL = `# IMPL: test-feature

**Test Command:** go test ./...
**Lint Command:** go vet ./...

## Wave 1

### Agent A: Do the thing

Implement it.

### File Ownership

| File | Agent | Wave | Depends On |
|------|-------|------|------------|
| pkg/foo/bar.go | A | 1 | — |
`

// TestHandleGetImpl_Found verifies that a valid IMPL doc is returned as 200 JSON.
func TestHandleGetImpl_Found(t *testing.T) {
	s, dir := makeTestServer(t)
	writeIMPLDoc(t, dir, "test-feature", minimalIMPL)

	req := httptest.NewRequest(http.MethodGet, "/api/impl/test-feature", nil)
	req.SetPathValue("slug", "test-feature")
	rr := httptest.NewRecorder()

	s.handleGetImpl(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	ct := rr.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "application/json") {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}

	var resp IMPLDocResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode JSON response: %v", err)
	}

	if resp.Slug != "test-feature" {
		t.Errorf("expected slug %q, got %q", "test-feature", resp.Slug)
	}
}

// TestHandleGetImpl_NotFound verifies that a missing IMPL doc returns 404.
func TestHandleGetImpl_NotFound(t *testing.T) {
	s, _ := makeTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/impl/no-such-feature", nil)
	req.SetPathValue("slug", "no-such-feature")
	rr := httptest.NewRecorder()

	s.handleGetImpl(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

// TestHandleApprove_PublishesEvent verifies that approve returns 202.
func TestHandleApprove_PublishesEvent(t *testing.T) {
	s, _ := makeTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/api/impl/myfeature/approve", nil)
	req.SetPathValue("slug", "myfeature")
	rr := httptest.NewRecorder()

	s.handleApprove(rr, req)

	if rr.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d", rr.Code)
	}
}

// TestHandleWaveStart_Returns202 verifies that the start endpoint returns 202 Accepted
// for a slug that is not currently active.
func TestHandleWaveStart_Returns202(t *testing.T) {
	s, dir := makeTestServer(t)
	writeIMPLDoc(t, dir, "my-feature", minimalIMPL)

	req := httptest.NewRequest(http.MethodPost, "/api/wave/my-feature/start", nil)
	req.SetPathValue("slug", "my-feature")
	rr := httptest.NewRecorder()

	s.handleWaveStart(rr, req)

	if rr.Code != http.StatusAccepted {
		t.Errorf("expected 202, got %d: %s", rr.Code, rr.Body.String())
	}
}

// TestHandleWaveStart_Returns409WhenActive verifies that a second concurrent start
// for the same slug returns 409 Conflict.
func TestHandleWaveStart_Returns409WhenActive(t *testing.T) {
	s, dir := makeTestServer(t)
	writeIMPLDoc(t, dir, "my-feature", minimalIMPL)

	// Pre-load the slug to simulate an in-progress run.
	s.activeRuns.Store("my-feature", struct{}{})

	req := httptest.NewRequest(http.MethodPost, "/api/wave/my-feature/start", nil)
	req.SetPathValue("slug", "my-feature")
	rr := httptest.NewRecorder()

	s.handleWaveStart(rr, req)

	if rr.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d: %s", rr.Code, rr.Body.String())
	}
}

// TestHandleWaveEvents_StreamsEvent verifies that published events appear in the SSE stream.
//
// Uses httptest.Server for a real HTTP connection (needed for http.Flusher).
// The HTTP client reads in a goroutine; the main test goroutine publishes an
// event and waits for the line reader to receive it, then closes the server.
func TestHandleWaveEvents_StreamsEvent(t *testing.T) {
	s, _ := makeTestServer(t)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.SetPathValue("slug", "myfeature")
		s.handleWaveEvents(w, r)
	}))
	defer ts.Close()

	// lineCh receives text lines read from the SSE response body.
	lineCh := make(chan string, 32)

	// Start the HTTP request and line reader in a goroutine so the main
	// goroutine can publish events while the client is streaming.
	go func() {
		resp, err := http.Get(ts.URL + "/api/wave/myfeature/events") //nolint:noctx
		if err != nil {
			return
		}
		defer resp.Body.Close()
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			lineCh <- sc.Text()
		}
	}()

	// Wait briefly so the subscriber has registered before we publish.
	// Poll until the broker has at least one subscriber for "myfeature".
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		s.broker.mu.Lock()
		n := len(s.broker.clients["myfeature"])
		s.broker.mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}

	// Publish an event.
	ev := SSEEvent{Event: "agent_complete", Data: map[string]string{"agent": "A"}}
	s.broker.Publish("myfeature", ev)

	// Collect lines until we see the blank-line SSE message terminator or timeout.
	var lines []string
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
outer:
	for {
		select {
		case line := <-lineCh:
			lines = append(lines, line)
			if line == "" {
				break outer // end of one SSE message
			}
		case <-timer.C:
			t.Fatal("timed out waiting for SSE event")
		}
	}

	// CloseClientConnections drops active connections, which causes r.Context()
	// to cancel inside handleWaveEvents and lets the handler exit cleanly.
	// Then Close() can complete without blocking.
	ts.CloseClientConnections()
	ts.Close()

	// Verify the event and data lines are present.
	foundEvent := false
	foundData := false
	for _, l := range lines {
		if strings.HasPrefix(l, "event: agent_complete") {
			foundEvent = true
		}
		if strings.HasPrefix(l, "data: ") {
			foundData = true
		}
	}
	if !foundEvent {
		t.Errorf("expected 'event: agent_complete' in SSE output; got: %v", lines)
	}
	if !foundData {
		t.Errorf("expected 'data:' line in SSE output; got: %v", lines)
	}
}
