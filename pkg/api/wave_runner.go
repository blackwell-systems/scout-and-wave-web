package api

import (
	"net/http"
	"path/filepath"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

// waveOrchestrator is the interface needed by runWaveLoop.
// Matches pkg/orchestrator.Orchestrator methods.
type waveOrchestrator interface {
	RunWave(waveNum int) error
	MergeWave(waveNum int) error
	RunVerification(testCommand string) error
	UpdateIMPLStatus(waveNum int) error
	IMPLDoc() *types.IMPLDoc
}

// handleWaveStart handles POST /api/wave/{slug}/start.
// It checks whether the slug is already running (409), marks it active, then
// launches wave execution in a background goroutine and immediately returns 202.
func (s *Server) handleWaveStart(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	// Check for an already-active run; store atomically if not present.
	if _, loaded := s.activeRuns.LoadOrStore(slug, struct{}{}); loaded {
		http.Error(w, "wave already running", http.StatusConflict)
		return
	}

	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".md")
	publish := s.makePublisher(slug)

	go func() {
		defer s.activeRuns.Delete(slug)
		runWaveLoop(implPath, slug, publish)
	}()

	w.WriteHeader(http.StatusAccepted)
}

// runWaveLoop is the background goroutine body. It is a placeholder that will
// be wired to the real orchestrator after Agent A's EventPublisher work is
// merged. For now it publishes a single "run_started" event so that the SSE
// stream has observable output.
//
// TODO: Replace with orchestrator.New + full wave-execution loop post-merge.
func runWaveLoop(implPath, slug string, publish func(event string, data interface{})) {
	publish("run_started", map[string]string{"slug": slug, "impl_path": implPath})
	// Full orchestration loop (RunWave, MergeWave, RunVerification,
	// UpdateIMPLStatus) will be wired here once Agent A's SetEventPublisher
	// is available in the merged codebase.
}

// makePublisher creates a function that maps orchestrator events to SSE events.
// TODO: Wire to orchestrator.EventPublisher after Agent A's work is merged.
func (s *Server) makePublisher(slug string) func(event string, data interface{}) {
	return func(event string, data interface{}) {
		s.broker.Publish(slug, SSEEvent{Event: event, Data: data})
	}
}
