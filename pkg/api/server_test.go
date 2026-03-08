package api

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// newCancelledCtx returns a context that is already cancelled and its cancel
// function. Useful for driving handlers that block on r.Context().Done().
func newCancelledCtx() (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately
	return ctx, cancel
}

// ---------------------------------------------------------------------------
// sseBroker unit tests
// ---------------------------------------------------------------------------

// TestSSEBroker_PublishDelivered verifies that a published event is received
// by a subscriber on the returned channel.
func TestSSEBroker_PublishDelivered(t *testing.T) {
	b := &sseBroker{clients: make(map[string][]chan SSEEvent)}
	ch := b.subscribe("slug-a")

	ev := SSEEvent{Event: "agent_complete", Data: map[string]string{"agent": "A"}}
	b.Publish("slug-a", ev)

	select {
	case got := <-ch:
		if got.Event != ev.Event {
			t.Errorf("expected event %q, got %q", ev.Event, got.Event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out: event not delivered to subscriber")
	}
}

// TestSSEBroker_SlowClientDropped verifies that Publish does not block when
// the subscriber channel buffer (capacity 16) is already full.
func TestSSEBroker_SlowClientDropped(t *testing.T) {
	b := &sseBroker{clients: make(map[string][]chan SSEEvent)}
	ch := b.subscribe("slug-slow")

	ev := SSEEvent{Event: "tick", Data: nil}

	// Fill the channel to capacity (16) without reading.
	for i := 0; i < cap(ch); i++ {
		b.Publish("slug-slow", ev)
	}

	// This 17th Publish must not block; the event is silently dropped.
	done := make(chan struct{})
	go func() {
		b.Publish("slug-slow", ev)
		close(done)
	}()

	select {
	case <-done:
		// success: Publish returned without blocking
	case <-time.After(time.Second):
		t.Fatal("Publish blocked on a full subscriber channel")
	}

	// Drain the channel to leave the test clean.
	for len(ch) > 0 {
		<-ch
	}
}

// TestSSEBroker_Unsubscribe verifies that after unsubscribing no further events
// are delivered to the removed channel.
func TestSSEBroker_Unsubscribe(t *testing.T) {
	b := &sseBroker{clients: make(map[string][]chan SSEEvent)}
	ch := b.subscribe("slug-b")

	// Confirm the subscription is registered.
	b.mu.Lock()
	n := len(b.clients["slug-b"])
	b.mu.Unlock()
	if n != 1 {
		t.Fatalf("expected 1 subscriber before unsubscribe, got %d", n)
	}

	b.unsubscribe("slug-b", ch)

	// Confirm the subscription has been removed.
	b.mu.Lock()
	n = len(b.clients["slug-b"])
	b.mu.Unlock()
	if n != 0 {
		t.Fatalf("expected 0 subscribers after unsubscribe, got %d", n)
	}

	// Publishing after unsubscribe must not deliver anything to the channel.
	b.Publish("slug-b", SSEEvent{Event: "after_unsub", Data: nil})

	select {
	case got := <-ch:
		t.Errorf("received unexpected event after unsubscribe: %v", got)
	case <-time.After(50 * time.Millisecond):
		// correct: nothing delivered
	}
}

// ---------------------------------------------------------------------------
// handleWaveEvents integration tests
// ---------------------------------------------------------------------------

// TestHandleWaveEvents_StreamsEvents starts a real HTTP test server, connects
// a streaming SSE client, publishes two events via the broker, reads both from
// the stream, and verifies the event/data lines are correct.
func TestHandleWaveEvents_StreamsEvents(t *testing.T) {
	s, _ := makeTestServer(t)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.SetPathValue("slug", "stream-slug")
		s.handleWaveEvents(w, r)
	}))
	defer ts.Close()

	lineCh := make(chan string, 64)

	go func() {
		resp, err := http.Get(ts.URL + "/api/wave/stream-slug/events") //nolint:noctx
		if err != nil {
			return
		}
		defer resp.Body.Close()
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			lineCh <- sc.Text()
		}
	}()

	// Wait until the subscriber is registered.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		s.broker.mu.Lock()
		n := len(s.broker.clients["stream-slug"])
		s.broker.mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}

	// Publish two events.
	s.broker.Publish("stream-slug", SSEEvent{Event: "wave_started", Data: map[string]string{"wave": "1"}})
	s.broker.Publish("stream-slug", SSEEvent{Event: "wave_complete", Data: map[string]string{"wave": "1"}})

	// Collect until we see two blank-line message terminators.
	var lines []string
	blankCount := 0
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
collect:
	for {
		select {
		case line := <-lineCh:
			lines = append(lines, line)
			if line == "" {
				blankCount++
				if blankCount >= 2 {
					break collect
				}
			}
		case <-timer.C:
			t.Fatalf("timed out waiting for two SSE messages; got lines: %v", lines)
		}
	}

	ts.CloseClientConnections()

	wantEvents := []string{"wave_started", "wave_complete"}
	for _, want := range wantEvents {
		found := false
		for _, l := range lines {
			if strings.Contains(l, want) {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected event %q in SSE output; got: %v", want, lines)
		}
	}
}

// TestHandleWaveEvents_ContentTypeHeader verifies that handleWaveEvents sets
// Content-Type: text/event-stream on the response.
//
// Uses httptest.ResponseRecorder directly against the handler; the handler
// blocks on r.Context().Done(), so we supply a request with a pre-cancelled
// context so the handler returns immediately.
func TestHandleWaveEvents_ContentTypeHeader(t *testing.T) {
	s, _ := makeTestServer(t)

	// Use a response recorder backed by a real http.ResponseWriter that
	// implements http.Flusher. httptest.ResponseRecorder implements Flusher
	// (it no-ops Flush). The handler checks for Flusher and returns 500 if
	// absent — but ResponseRecorder does implement it, so this is safe.
	//
	// Provide a pre-cancelled context so the handler's select on
	// r.Context().Done() exits immediately after the subscription.
	ctx, cancel := newCancelledCtx()
	defer cancel()

	req := httptest.NewRequest(http.MethodGet, "/api/wave/ct-slug/events", nil)
	req = req.WithContext(ctx)
	req.SetPathValue("slug", "ct-slug")
	rr := httptest.NewRecorder()

	s.handleWaveEvents(rr, req)

	ct := rr.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "text/event-stream") {
		t.Errorf("expected Content-Type text/event-stream, got %q", ct)
	}
}

// ---------------------------------------------------------------------------
// handleWaveStart additional tests
// ---------------------------------------------------------------------------

// TestHandleWaveStart_Returns409_OnDuplicate verifies that a POST to start a
// wave that is already marked active returns 409 Conflict. The active entry is
// pre-loaded into activeRuns to simulate a concurrent run without timing
// dependence on the stub's goroutine scheduling.
func TestHandleWaveStart_Returns409_OnDuplicate(t *testing.T) {
	s, dir := makeTestServer(t)
	writeIMPLDoc(t, dir, "dup-feature", minimalIMPL)

	// Simulate a run already in progress.
	s.activeRuns.Store("dup-feature", struct{}{})

	req := httptest.NewRequest(http.MethodPost, "/api/wave/dup-feature/start", nil)
	req.SetPathValue("slug", "dup-feature")
	rr := httptest.NewRecorder()

	s.handleWaveStart(rr, req)

	if rr.Code != http.StatusConflict {
		t.Errorf("expected 409 on duplicate start, got %d: %s", rr.Code, rr.Body.String())
	}
}

// ---------------------------------------------------------------------------
// makePublisher tests
// ---------------------------------------------------------------------------

// TestMakePublisher_PublishesToBroker verifies that the closure returned by
// makePublisher correctly constructs an SSEEvent and publishes it to the
// broker under the given slug.
func TestMakePublisher_PublishesToBroker(t *testing.T) {
	s, _ := makeTestServer(t)

	// Subscribe to "pub-slug" so we can observe what the publisher delivers.
	ch := s.broker.subscribe("pub-slug")
	defer s.broker.unsubscribe("pub-slug", ch)

	publish := s.makePublisher("pub-slug")

	wantEvent := "agent_started"
	wantData := map[string]string{"agent": "B"}
	publish(wantEvent, wantData)

	select {
	case got := <-ch:
		if got.Event != wantEvent {
			t.Errorf("expected event %q, got %q", wantEvent, got.Event)
		}
		// Verify Data round-trips correctly via JSON (as the handler will marshal it).
		gotJSON, err := json.Marshal(got.Data)
		if err != nil {
			t.Fatalf("failed to marshal received data: %v", err)
		}
		var gotMap map[string]string
		if err := json.Unmarshal(gotJSON, &gotMap); err != nil {
			t.Fatalf("failed to unmarshal received data: %v", err)
		}
		if gotMap["agent"] != wantData["agent"] {
			t.Errorf("expected data agent=%q, got %q", wantData["agent"], gotMap["agent"])
		}
	case <-time.After(time.Second):
		t.Fatal("timed out: makePublisher did not deliver event to broker subscriber")
	}
}

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

// ---------------------------------------------------------------------------
// handleListImpls doc_status casing tests
// ---------------------------------------------------------------------------

// implListEntryRaw is used to decode the list response for casing checks.
type implListEntryRaw struct {
	Slug      string `json:"slug"`
	DocStatus string `json:"doc_status"`
}

// TestHandleListImpls_DocStatusLowercase verifies that an active IMPL doc returns
// doc_status "active" (lowercase), not "ACTIVE".
func TestHandleListImpls_DocStatusLowercase(t *testing.T) {
	s, dir := makeTestServer(t)
	writeIMPLDoc(t, dir, "active-feature", minimalIMPL)

	req := httptest.NewRequest(http.MethodGet, "/api/impl", nil)
	rr := httptest.NewRecorder()
	s.handleListImpls(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var entries []implListEntryRaw
	if err := json.NewDecoder(rr.Body).Decode(&entries); err != nil {
		t.Fatalf("failed to decode JSON: %v", err)
	}

	if len(entries) == 0 {
		t.Fatal("expected at least one entry, got none")
	}
	for _, e := range entries {
		if e.Slug == "active-feature" {
			if e.DocStatus != "active" {
				t.Errorf("expected doc_status %q, got %q", "active", e.DocStatus)
			}
			return
		}
	}
	t.Error("active-feature not found in list response")
}

// TestHandleListImpls_DocStatusComplete verifies that an IMPL doc with the
// SAW:COMPLETE tag returns doc_status "complete" (lowercase), not "COMPLETE".
func TestHandleListImpls_DocStatusComplete(t *testing.T) {
	s, dir := makeTestServer(t)
	completeIMPL := minimalIMPL + "\n<!-- SAW:COMPLETE 2024-01-15 -->\n"
	writeIMPLDoc(t, dir, "done-feature", completeIMPL)

	req := httptest.NewRequest(http.MethodGet, "/api/impl", nil)
	rr := httptest.NewRecorder()
	s.handleListImpls(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var entries []implListEntryRaw
	if err := json.NewDecoder(rr.Body).Decode(&entries); err != nil {
		t.Fatalf("failed to decode JSON: %v", err)
	}

	for _, e := range entries {
		if e.Slug == "done-feature" {
			if e.DocStatus != "complete" {
				t.Errorf("expected doc_status %q, got %q", "complete", e.DocStatus)
			}
			return
		}
	}
	t.Error("done-feature not found in list response")
}

// ---------------------------------------------------------------------------
// handleGetImpl pre_mortem and doc_status tests
// ---------------------------------------------------------------------------

const implWithPreMortem = `# IMPL: premortem-feature

**Test Command:** go test ./...
**Lint Command:** go vet ./...

## Pre-Mortem

**Overall risk:** medium

| Scenario | Likelihood | Impact | Mitigation |
|----------|-----------|--------|------------|
| DB schema mismatch | high | high | Run migration tests |
| Agent timeout | low | medium | Add deadline context |

## Wave 1

### Agent A: Do the thing

Implement it.

### File Ownership

| File | Agent | Wave | Depends On |
|------|-------|------|------------|
| pkg/foo/bar.go | A | 1 | — |
`

// TestHandleGetImpl_PreMortem verifies that when a ## Pre-Mortem section exists
// in the IMPL doc, the pre_mortem field is populated in the response, and that
// it is absent (nil/omitted) when the section is not present.
func TestHandleGetImpl_PreMortem(t *testing.T) {
	s, dir := makeTestServer(t)

	// Case 1: doc WITH pre-mortem section.
	writeIMPLDoc(t, dir, "premortem-feature", implWithPreMortem)
	req := httptest.NewRequest(http.MethodGet, "/api/impl/premortem-feature", nil)
	req.SetPathValue("slug", "premortem-feature")
	rr := httptest.NewRecorder()
	s.handleGetImpl(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp IMPLDocResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode JSON response: %v", err)
	}

	if resp.PreMortem == nil {
		t.Fatal("expected pre_mortem to be non-nil when section present")
	}
	if resp.PreMortem.OverallRisk != "medium" {
		t.Errorf("expected OverallRisk %q, got %q", "medium", resp.PreMortem.OverallRisk)
	}
	if len(resp.PreMortem.Rows) != 2 {
		t.Fatalf("expected 2 pre-mortem rows, got %d", len(resp.PreMortem.Rows))
	}
	if resp.PreMortem.Rows[0].Scenario != "DB schema mismatch" {
		t.Errorf("expected Rows[0].Scenario %q, got %q", "DB schema mismatch", resp.PreMortem.Rows[0].Scenario)
	}
	if resp.PreMortem.Rows[1].Mitigation != "Add deadline context" {
		t.Errorf("expected Rows[1].Mitigation %q, got %q", "Add deadline context", resp.PreMortem.Rows[1].Mitigation)
	}

	// Case 2: doc WITHOUT pre-mortem section.
	writeIMPLDoc(t, dir, "no-premortem", minimalIMPL)
	req2 := httptest.NewRequest(http.MethodGet, "/api/impl/no-premortem", nil)
	req2.SetPathValue("slug", "no-premortem")
	rr2 := httptest.NewRecorder()
	s.handleGetImpl(rr2, req2)

	var resp2 IMPLDocResponse
	if err := json.NewDecoder(rr2.Body).Decode(&resp2); err != nil {
		t.Fatalf("failed to decode JSON response (no pre-mortem): %v", err)
	}
	if resp2.PreMortem != nil {
		t.Errorf("expected pre_mortem to be nil when section absent, got %+v", resp2.PreMortem)
	}
}

// TestHandleGetImpl_DocStatus verifies that doc_status in the GET /api/impl/{slug}
// response is lowercase ("active" or "complete"), not uppercase.
func TestHandleGetImpl_DocStatus(t *testing.T) {
	s, dir := makeTestServer(t)

	// Active doc.
	writeIMPLDoc(t, dir, "active-slug", minimalIMPL)
	req := httptest.NewRequest(http.MethodGet, "/api/impl/active-slug", nil)
	req.SetPathValue("slug", "active-slug")
	rr := httptest.NewRecorder()
	s.handleGetImpl(rr, req)

	var resp IMPLDocResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode JSON: %v", err)
	}
	if resp.DocStatus != "active" {
		t.Errorf("expected doc_status %q for active doc, got %q", "active", resp.DocStatus)
	}

	// Complete doc (has SAW:COMPLETE tag so DocStatus == "COMPLETE" after parsing).
	completeIMPL := minimalIMPL + "\n<!-- SAW:COMPLETE 2024-01-15 -->\n"
	writeIMPLDoc(t, dir, "complete-slug", completeIMPL)
	req2 := httptest.NewRequest(http.MethodGet, "/api/impl/complete-slug", nil)
	req2.SetPathValue("slug", "complete-slug")
	rr2 := httptest.NewRecorder()
	s.handleGetImpl(rr2, req2)

	var resp2 IMPLDocResponse
	if err := json.NewDecoder(rr2.Body).Decode(&resp2); err != nil {
		t.Fatalf("failed to decode JSON: %v", err)
	}
	if resp2.DocStatus != "complete" {
		t.Errorf("expected doc_status %q for complete doc, got %q", "complete", resp2.DocStatus)
	}
}

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
	// Inject a no-op loop so the background goroutine doesn't write to the
	// temp dir after the test ends (which would cause TempDir cleanup to fail).
	// done channel ensures t.Cleanup waits for the goroutine to finish reading
	// runWaveLoopFunc before restoring it, preventing a data race.
	done := make(chan struct{})
	orig := runWaveLoopFunc
	runWaveLoopFunc = func(implPath, slug, repoPath string, publish func(string, interface{})) {
		defer close(done)
	}
	t.Cleanup(func() {
		<-done
		runWaveLoopFunc = orig
	})

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
