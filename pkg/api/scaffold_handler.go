package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/config"
	engine "github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
)

// ScaffoldRerunResponse is the JSON body returned by POST /api/impl/{slug}/scaffold/rerun.
type ScaffoldRerunResponse struct {
	RunID string `json:"run_id"`
}

// handleScaffoldRerun handles POST /api/impl/{slug}/scaffold/rerun.
// Resolves the IMPL doc path, launches the scaffold agent in a background
// goroutine, and returns 202 with {"run_id": "..."}. Events are published to
// the existing wave SSE broker for the slug so the WaveBoard picks them up
// without a dedicated scaffold SSE endpoint.
func (s *Server) handleScaffoldRerun(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	// Resolve IMPL doc path.
	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".yaml")
	if _, err := os.Stat(implPath); os.IsNotExist(err) {
		http.Error(w, "IMPL doc not found for slug: "+slug, http.StatusNotFound)
		return
	}

	runID := fmt.Sprintf("%d", time.Now().UnixNano())
	ctx, cancel := context.WithCancel(context.Background())
	s.scaffoldRuns.Store(runID, cancel)

	go func() {
		defer s.scaffoldRuns.Delete(runID)
		defer cancel()
		s.runScaffoldAgent(ctx, slug, runID, implPath)
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(ScaffoldRerunResponse{RunID: runID}) //nolint:errcheck
}

// runScaffoldAgent runs engine.RunScaffold and forwards all events to the wave
// SSE broker under the slug. Handles context cancellation by publishing
// scaffold_cancelled. The engine itself publishes scaffold_started,
// scaffold_output, scaffold_failed, and scaffold_complete.
func (s *Server) runScaffoldAgent(ctx context.Context, slug, runID, implPath string) {
	sawRepo := os.Getenv("SAW_REPO")
	if sawRepo == "" {
		home, _ := os.UserHomeDir()
		sawRepo = filepath.Join(home, "code", "scout-and-wave")
	}

	onEvent := func(ev engine.Event) {
		s.broker.Publish(slug, SSEEvent{Event: ev.Event, Data: ev.Data})
	}

	// Read scaffold model from config.
	scaffoldModel := ""
	if sawCfg := config.LoadOrDefault(s.cfg.RepoPath); sawCfg != nil {
		scaffoldModel = sawCfg.Agent.ScaffoldModel
	}

	if err := engine.RunScaffold(ctx, implPath, s.cfg.RepoPath, sawRepo, scaffoldModel, onEvent); err != nil {
		if ctx.Err() != nil {
			s.broker.Publish(slug, SSEEvent{
				Event: "scaffold_cancelled",
				Data:  map[string]string{"run_id": runID, "slug": slug},
			})
		}
		// scaffold_failed already published by engine; no double-publish needed.
	}
}
