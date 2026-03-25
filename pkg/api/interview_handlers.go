package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/interview"
)

// InterviewStartRequest is the JSON body for POST /api/interview/start.
type InterviewStartRequest struct {
	Description  string `json:"description"`
	MaxQuestions int    `json:"max_questions,omitempty"`
	ProjectPath  string `json:"project_path,omitempty"`
}

// InterviewStartResponse is the JSON response for POST /api/interview/start.
type InterviewStartResponse struct {
	RunID string `json:"run_id"`
}

// InterviewResumeRequest is the JSON body for POST /api/interview/resume.
type InterviewResumeRequest struct {
	DocPath string `json:"doc_path"` // path to INTERVIEW-<slug>.yaml
}

// InterviewQuestionEvent is the SSE event data for "question" events.
// Event types: "question", "answer_recorded", "phase_complete", "complete", "error"
type InterviewQuestionEvent struct {
	Phase        string `json:"phase"`
	QuestionNum  int    `json:"question_num"`
	MaxQuestions int    `json:"max_questions"`
	Text         string `json:"text"`
	Hint         string `json:"hint,omitempty"`
}

// InterviewAnswerRequest is the JSON body for POST /api/interview/{runID}/answer.
type InterviewAnswerRequest struct {
	Answer string `json:"answer"`
}

// interviewRun holds the state for a running interview session.
type interviewRun struct {
	cancel  context.CancelFunc
	mgr     *interview.DeterministicManager
	docMu   sync.Mutex
	doc     *interview.InterviewDoc
	answers chan string // buffered; handler sends answers here
}

// handleInterviewStart handles POST /api/interview/start.
// Creates a new DeterministicManager, starts an interview, stores the run,
// and returns a run ID so the client can subscribe to SSE and submit answers.
func (s *Server) handleInterviewStart(w http.ResponseWriter, r *http.Request) {
	var req InterviewStartRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Description == "" {
		respondError(w, "description is required", http.StatusBadRequest)
		return
	}

	// Generate a run ID using current time nanoseconds.
	runID := fmt.Sprintf("interview-%d", time.Now().UnixNano())

	// Determine the docs directory.
	docsDir := s.cfg.RepoPath
	if req.ProjectPath != "" {
		docsDir = req.ProjectPath
	}

	mgr := interview.NewDeterministicManager(docsDir)

	maxQ := req.MaxQuestions
	if maxQ == 0 {
		maxQ = 18
	}

	cfg := interview.InterviewConfig{
		Description:  req.Description,
		Mode:         interview.ModeDeterministic,
		MaxQuestions: maxQ,
		ProjectPath:  req.ProjectPath,
	}

	doc, firstQ, err := mgr.Start(cfg)
	if err != nil {
		respondError(w, "failed to start interview: "+err.Error(), http.StatusInternalServerError)
		return
	}

	ctx, cancel := context.WithCancel(s.serverCtx)

	run := &interviewRun{
		cancel:  cancel,
		mgr:     mgr,
		doc:     doc,
		answers: make(chan string, 1),
	}
	s.interviewRuns.Store(runID, run)

	// Background goroutine: emits the first question via SSE, then waits for
	// answers and emits subsequent questions until the interview completes.
	go s.runInterviewLoop(ctx, runID, run, firstQ)

	respondJSON(w, http.StatusAccepted, InterviewStartResponse{RunID: runID})
}

// handleInterviewResume handles POST /api/interview/resume.
// Loads an existing INTERVIEW-<slug>.yaml from disk and resumes the interview,
// returning a new run ID so the client can subscribe to SSE and submit answers.
func (s *Server) handleInterviewResume(w http.ResponseWriter, r *http.Request) {
	var req InterviewResumeRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.DocPath == "" {
		respondError(w, "doc_path is required", http.StatusBadRequest)
		return
	}

	// Verify file exists.
	if _, err := os.Stat(req.DocPath); os.IsNotExist(err) {
		respondError(w, "interview doc not found: "+req.DocPath, http.StatusNotFound)
		return
	}

	// Determine docsDir from the file's directory.
	docsDir := filepath.Dir(req.DocPath)
	mgr := interview.NewDeterministicManager(docsDir)

	doc, firstQ, err := mgr.Resume(req.DocPath)
	if err != nil {
		respondError(w, "failed to resume interview: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// If already complete, return 409 Conflict.
	if doc.Status == "complete" || firstQ == nil {
		respondError(w, "interview is already complete", http.StatusConflict)
		return
	}

	runID := fmt.Sprintf("interview-%d", time.Now().UnixNano())
	ctx, cancel := context.WithCancel(s.serverCtx)

	run := &interviewRun{
		cancel:  cancel,
		mgr:     mgr,
		doc:     doc,
		answers: make(chan string, 1),
	}
	s.interviewRuns.Store(runID, run)

	go s.runInterviewLoop(ctx, runID, run, firstQ)

	respondJSON(w, http.StatusAccepted, InterviewStartResponse{RunID: runID})
}

// runInterviewLoop drives the interview state machine in a goroutine.
// It emits SSE events for questions and completion, processing answers
// as they arrive from the answers channel.
func (s *Server) runInterviewLoop(ctx context.Context, runID string, run *interviewRun, firstQ *interview.InterviewQuestion) {
	brokerKey := "interview-" + runID

	defer func() {
		// Always clean up the run entry on exit.
		s.interviewRuns.Delete(runID)
	}()

	// Emit the first question.
	if firstQ != nil {
		run.docMu.Lock()
		doc := run.doc
		run.docMu.Unlock()

		s.broker.Publish(brokerKey, SSEEvent{
			Event: "question",
			Data: InterviewQuestionEvent{
				Phase:        string(firstQ.Phase),
				QuestionNum:  doc.QuestionCursor + 1,
				MaxQuestions: doc.MaxQuestions,
				Text:         firstQ.Text,
				Hint:         firstQ.Hint,
			},
		})
	}

	// Process answers until complete or cancelled.
	for {
		select {
		case <-ctx.Done():
			// Interview cancelled.
			s.broker.Publish(brokerKey, SSEEvent{
				Event: "error",
				Data:  map[string]string{"message": "interview cancelled"},
			})
			return

		case answer := <-run.answers:
			// Capture phase BEFORE updating doc.
			run.docMu.Lock()
			doc := run.doc
			previousPhase := run.doc.Phase
			run.docMu.Unlock()

			updatedDoc, nextQ, err := run.mgr.Answer(doc, answer)
			if err != nil {
				s.broker.Publish(brokerKey, SSEEvent{
					Event: "error",
					Data:  map[string]string{"message": err.Error()},
				})
				continue
			}

			run.docMu.Lock()
			run.doc = updatedDoc
			run.docMu.Unlock()

			// Emit answer_recorded event.
			s.broker.Publish(brokerKey, SSEEvent{
				Event: "answer_recorded",
				Data:  map[string]string{"status": "recorded"},
			})

			// Emit phase_complete if phase changed.
			if string(updatedDoc.Phase) != string(previousPhase) && updatedDoc.Phase != "complete" {
				s.broker.Publish(brokerKey, SSEEvent{
					Event: "phase_complete",
					Data: map[string]string{
						"phase":      string(previousPhase),
						"next_phase": string(updatedDoc.Phase),
					},
				})
			}

			if updatedDoc.Status == "complete" || nextQ == nil {
				// Interview complete.
				s.broker.Publish(brokerKey, SSEEvent{
					Event: "complete",
					Data: map[string]interface{}{
						"requirements_path": updatedDoc.RequirementsPath,
						"slug":              updatedDoc.Slug,
					},
				})
				return
			}

			// Emit next question.
			s.broker.Publish(brokerKey, SSEEvent{
				Event: "question",
				Data: InterviewQuestionEvent{
					Phase:        string(nextQ.Phase),
					QuestionNum:  updatedDoc.QuestionCursor + 1,
					MaxQuestions: updatedDoc.MaxQuestions,
					Text:         nextQ.Text,
					Hint:         nextQ.Hint,
				},
			})
		}
	}
}

// handleInterviewEvents handles GET /api/interview/{runID}/events.
// Upgrades the connection to SSE and streams interview question/answer events.
func (s *Server) handleInterviewEvents(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	brokerKey := "interview-" + runID
	ch := s.broker.subscribe(brokerKey)
	defer s.broker.unsubscribe(brokerKey, ch)

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case ev := <-ch:
			data, err := json.Marshal(ev.Data)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Event, data)
			flusher.Flush()
		case <-ticker.C:
			fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

// handleInterviewAnswer handles POST /api/interview/{runID}/answer.
// Sends the user's answer to the running interview goroutine.
func (s *Server) handleInterviewAnswer(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")

	var req InterviewAnswerRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Answer == "" {
		respondError(w, "answer is required", http.StatusBadRequest)
		return
	}

	val, ok := s.interviewRuns.Load(runID)
	if !ok {
		respondError(w, "interview run not found", http.StatusNotFound)
		return
	}

	run, ok := val.(*interviewRun)
	if !ok {
		respondError(w, "invalid run state", http.StatusInternalServerError)
		return
	}

	// Send answer to the interview loop (non-blocking with timeout to detect
	// if the goroutine is not consuming — answers channel has buffer of 1).
	select {
	case run.answers <- req.Answer:
		w.WriteHeader(http.StatusNoContent)
	case <-time.After(5 * time.Second):
		respondError(w, "interview not ready to accept answers", http.StatusConflict)
	}
}

// handleInterviewCancel handles POST /api/interview/{runID}/cancel.
// Cancels the running interview and cleans up the run state.
func (s *Server) handleInterviewCancel(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")

	val, ok := s.interviewRuns.Load(runID)
	if !ok {
		// Idempotent: already gone is fine.
		w.WriteHeader(http.StatusNoContent)
		return
	}

	run, ok := val.(*interviewRun)
	if !ok {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	run.cancel()
	w.WriteHeader(http.StatusNoContent)
}
