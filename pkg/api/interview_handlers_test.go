package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/interview"
)

// newTestServerForInterview creates a minimal Server for interview handler tests.
// It uses an in-memory broker and a temporary docs directory.
func newTestServerForInterview(t *testing.T) *Server {
	t.Helper()
	tmpDir := t.TempDir()
	globalBroker := newGlobalBroker()
	serverCtx, serverCancel := context.WithCancel(context.Background())
	t.Cleanup(serverCancel)

	return &Server{
		cfg: Config{
			RepoPath: tmpDir,
			IMPLDir:  tmpDir,
		},
		broker:       &sseBroker{clients: make(map[string][]chan SSEEvent)},
		globalBroker: globalBroker,
		serverCtx:    serverCtx,
		serverCancel: serverCancel,
	}
}

// TestHandleInterviewStart_ValidRequest verifies that a valid start request
// returns 202 with a run_id and stores the run in interviewRuns.
func TestHandleInterviewStart_ValidRequest(t *testing.T) {
	s := newTestServerForInterview(t)

	body := `{"description":"add dark mode","max_questions":5}`
	r := httptest.NewRequest(http.MethodPost, "/api/interview/start", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	s.handleInterviewStart(w, r)

	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", w.Code, w.Body.String())
	}

	var resp InterviewStartResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.RunID == "" {
		t.Error("expected non-empty run_id")
	}
	if !strings.HasPrefix(resp.RunID, "interview-") {
		t.Errorf("expected run_id to start with 'interview-', got %q", resp.RunID)
	}

	// Verify run was stored.
	val, ok := s.interviewRuns.Load(resp.RunID)
	if !ok {
		t.Fatal("expected run to be stored in interviewRuns")
	}
	run, ok := val.(*interviewRun)
	if !ok {
		t.Fatal("expected *interviewRun stored in interviewRuns")
	}
	if run.mgr == nil {
		t.Error("expected mgr to be non-nil")
	}
	if run.answers == nil {
		t.Error("expected answers channel to be non-nil")
	}
}

// TestHandleInterviewStart_MissingDescription verifies that a missing description
// returns 400.
func TestHandleInterviewStart_MissingDescription(t *testing.T) {
	s := newTestServerForInterview(t)

	body := `{"max_questions":5}`
	r := httptest.NewRequest(http.MethodPost, "/api/interview/start", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	s.handleInterviewStart(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestHandleInterviewStart_EmptyBody verifies that an empty body returns 400.
func TestHandleInterviewStart_EmptyBody(t *testing.T) {
	s := newTestServerForInterview(t)

	r := httptest.NewRequest(http.MethodPost, "/api/interview/start", strings.NewReader(""))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	s.handleInterviewStart(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestHandleInterviewAnswer_RunNotFound verifies that answering an unknown runID returns 404.
func TestHandleInterviewAnswer_RunNotFound(t *testing.T) {
	s := newTestServerForInterview(t)

	body := `{"answer":"my answer"}`
	r := httptest.NewRequest(http.MethodPost, "/api/interview/nonexistent/answer", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.SetPathValue("runID", "nonexistent")
	w := httptest.NewRecorder()

	s.handleInterviewAnswer(w, r)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// TestHandleInterviewAnswer_EmptyAnswer verifies that an empty answer returns 400.
func TestHandleInterviewAnswer_EmptyAnswer(t *testing.T) {
	s := newTestServerForInterview(t)

	body := `{"answer":""}`
	r := httptest.NewRequest(http.MethodPost, "/api/interview/run1/answer", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.SetPathValue("runID", "run1")
	w := httptest.NewRecorder()

	s.handleInterviewAnswer(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// TestHandleInterviewAnswer_SendsAnswerToLoop verifies that a valid answer
// is delivered to the interview loop goroutine.
func TestHandleInterviewAnswer_SendsAnswerToLoop(t *testing.T) {
	s := newTestServerForInterview(t)

	// Manually create a run with an answer channel.
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	run := &interviewRun{
		cancel:  cancel,
		answers: make(chan string, 1),
	}
	s.interviewRuns.Store("test-run-1", run)

	body := `{"answer":"dark mode for accessibility"}`
	r := httptest.NewRequest(http.MethodPost, "/api/interview/test-run-1/answer", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.SetPathValue("runID", "test-run-1")
	w := httptest.NewRecorder()

	s.handleInterviewAnswer(w, r)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	select {
	case answer := <-run.answers:
		if answer != "dark mode for accessibility" {
			t.Errorf("expected answer %q, got %q", "dark mode for accessibility", answer)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for answer to be delivered to channel")
	}
}

// TestHandleInterviewCancel_RunNotFound verifies that cancelling an unknown runID
// returns 204 (idempotent).
func TestHandleInterviewCancel_RunNotFound(t *testing.T) {
	s := newTestServerForInterview(t)

	r := httptest.NewRequest(http.MethodPost, "/api/interview/nonexistent/cancel", nil)
	r.SetPathValue("runID", "nonexistent")
	w := httptest.NewRecorder()

	s.handleInterviewCancel(w, r)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", w.Code)
	}
}

// TestHandleInterviewCancel_CancelsRun verifies that cancelling a valid run
// triggers the context cancellation.
func TestHandleInterviewCancel_CancelsRun(t *testing.T) {
	s := newTestServerForInterview(t)

	ctx, cancel := context.WithCancel(context.Background())
	run := &interviewRun{
		cancel:  cancel,
		answers: make(chan string, 1),
	}
	s.interviewRuns.Store("cancel-test-run", run)

	r := httptest.NewRequest(http.MethodPost, "/api/interview/cancel-test-run/cancel", nil)
	r.SetPathValue("runID", "cancel-test-run")
	w := httptest.NewRecorder()

	s.handleInterviewCancel(w, r)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", w.Code)
	}

	// Verify context was cancelled.
	select {
	case <-ctx.Done():
		// Context was cancelled as expected.
	case <-time.After(time.Second):
		t.Fatal("expected context to be cancelled after handleInterviewCancel")
	}
}

// TestHandleInterviewEvents_StreamsSSE verifies that SSE events published to the
// broker are delivered to subscribers on GET /api/interview/{runID}/events.
func TestHandleInterviewEvents_StreamsSSE(t *testing.T) {
	s := newTestServerForInterview(t)

	runID := "sse-test-run"
	brokerKey := "interview-" + runID

	// Use a context we can cancel to stop the SSE handler.
	ctx, cancel := context.WithCancel(context.Background())

	r := httptest.NewRequest(http.MethodGet, "/api/interview/"+runID+"/events", nil)
	r = r.WithContext(ctx)
	r.SetPathValue("runID", runID)
	w := httptest.NewRecorder()

	// Run the handler in a goroutine so we can publish events concurrently.
	done := make(chan struct{})
	go func() {
		defer close(done)
		s.handleInterviewEvents(w, r)
	}()

	// Give the handler time to subscribe.
	time.Sleep(20 * time.Millisecond)

	// Publish a question event.
	s.broker.Publish(brokerKey, SSEEvent{
		Event: "question",
		Data: InterviewQuestionEvent{
			Phase:        "overview",
			QuestionNum:  1,
			MaxQuestions: 18,
			Text:         "What is the main goal of this feature?",
		},
	})

	// Give the handler time to write the event.
	time.Sleep(20 * time.Millisecond)

	// Cancel the request context to stop the handler.
	cancel()
	<-done

	body := w.Body.String()
	if !strings.Contains(body, "event: question") {
		t.Errorf("expected SSE 'event: question' in response, got:\n%s", body)
	}
	if !strings.Contains(body, "overview") {
		t.Errorf("expected phase 'overview' in SSE data, got:\n%s", body)
	}
}

// TestRunInterviewLoop_EmitsFirstQuestion verifies that the interview loop goroutine
// emits the first question event to the SSE broker immediately on start.
func TestRunInterviewLoop_EmitsFirstQuestion(t *testing.T) {
	s := newTestServerForInterview(t)

	runID := "loop-test-run"
	brokerKey := "interview-" + runID

	// Subscribe before starting loop.
	ch := s.broker.subscribe(brokerKey)
	defer s.broker.unsubscribe(brokerKey, ch)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	run := &interviewRun{
		cancel:  cancel,
		answers: make(chan string, 1),
		doc: &interview.InterviewDoc{
			QuestionCursor: 0,
			MaxQuestions:   18,
		},
	}
	s.interviewRuns.Store(runID, run)

	firstQ := &interview.InterviewQuestion{
		Phase: interview.PhaseOverview,
		Text:  "What is the main goal of this feature?",
	}

	go s.runInterviewLoop(ctx, runID, run, firstQ)

	// Expect first question event.
	select {
	case ev := <-ch:
		if ev.Event != "question" {
			t.Errorf("expected event 'question', got %q", ev.Event)
		}
		data, err := json.Marshal(ev.Data)
		if err != nil {
			t.Fatalf("marshal event data: %v", err)
		}
		var qev InterviewQuestionEvent
		if err := json.Unmarshal(data, &qev); err != nil {
			t.Fatalf("unmarshal question event: %v", err)
		}
		if qev.Text != "What is the main goal of this feature?" {
			t.Errorf("expected question text, got %q", qev.Text)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for first question event")
	}
}

// TestInterviewQuestionEvent_JSONSerialization verifies the struct serializes correctly.
func TestInterviewQuestionEvent_JSONSerialization(t *testing.T) {
	ev := InterviewQuestionEvent{
		Phase:        "overview",
		QuestionNum:  1,
		MaxQuestions: 18,
		Text:         "What is the feature goal?",
		Hint:         "Describe in one sentence",
	}

	data, err := json.Marshal(ev)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got map[string]interface{}
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if got["phase"] != "overview" {
		t.Errorf("phase = %v, want overview", got["phase"])
	}
	if got["question_num"].(float64) != 1 {
		t.Errorf("question_num = %v, want 1", got["question_num"])
	}
	if got["max_questions"].(float64) != 18 {
		t.Errorf("max_questions = %v, want 18", got["max_questions"])
	}
	if got["text"] != "What is the feature goal?" {
		t.Errorf("text = %v, want 'What is the feature goal?'", got["text"])
	}
	if got["hint"] != "Describe in one sentence" {
		t.Errorf("hint = %v, want 'Describe in one sentence'", got["hint"])
	}
}

// TestInterviewStartResponse_JSONSerialization verifies the response struct.
func TestInterviewStartResponse_JSONSerialization(t *testing.T) {
	resp := InterviewStartResponse{RunID: "interview-12345"}
	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var got map[string]interface{}
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if got["run_id"] != "interview-12345" {
		t.Errorf("run_id = %v, want interview-12345", got["run_id"])
	}
}
