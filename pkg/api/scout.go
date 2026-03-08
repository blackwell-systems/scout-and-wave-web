package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend/cli"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

// ScoutRunRequest is the JSON body for POST /api/scout/run.
type ScoutRunRequest struct {
	Feature string `json:"feature"`
	Repo    string `json:"repo,omitempty"`
}

// ScoutRunResponse is the JSON body returned by POST /api/scout/run.
type ScoutRunResponse struct {
	RunID string `json:"run_id"`
}

// scoutSlugify converts a feature description to a URL-safe slug.
// Named distinctly to avoid collision with the slugify function in cmd/saw/commands.go.
func scoutSlugify(s string) string {
	s = strings.ToLower(s)
	re := regexp.MustCompile(`[^a-z0-9]+`)
	s = re.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 40 {
		s = s[:40]
	}
	return s
}

// handleScoutRun handles POST /api/scout/run.
// Parses the JSON body, generates a unique runID, stores it, launches a
// background goroutine to execute the Scout agent, and returns 202 with
// JSON {"run_id": "<runID>"}.
func (s *Server) handleScoutRun(w http.ResponseWriter, r *http.Request) {
	var req ScoutRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Feature == "" {
		http.Error(w, "feature is required", http.StatusBadRequest)
		return
	}

	runID := fmt.Sprintf("%d", time.Now().UnixNano())
	s.scoutRuns.Store(runID, struct{}{})

	go func() {
		defer s.scoutRuns.Delete(runID)
		s.runScoutAgent(runID, req.Feature, req.Repo)
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(ScoutRunResponse{RunID: runID}) //nolint:errcheck
}

// handleScoutEvents handles GET /api/scout/{runID}/events.
// Upgrades the connection to SSE and streams scout output events until
// the client disconnects or the scout run completes.
func (s *Server) handleScoutEvents(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	brokerKey := "scout-" + runID
	ch := s.broker.subscribe(brokerKey)
	defer s.broker.unsubscribe(brokerKey, ch)

	for {
		select {
		case ev := <-ch:
			data, err := json.Marshal(ev.Data)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Event, data)
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

// runScoutAgent executes the Scout agent in a background goroutine.
// Publishes scout_output, scout_complete, and scout_failed SSE events.
func (s *Server) runScoutAgent(runID, feature, repoOverride string) {
	brokerKey := "scout-" + runID

	publish := func(event string, data interface{}) {
		s.broker.Publish(brokerKey, SSEEvent{Event: event, Data: data})
	}

	// Resolve repoRoot.
	repoRoot := repoOverride
	if repoRoot == "" {
		repoRoot = s.cfg.RepoPath
	}

	// Compute slug and IMPL output path.
	slug := scoutSlugify(feature)
	implOut := filepath.Join(repoRoot, "docs", "IMPL", "IMPL-"+slug+".md")

	// Locate scout.md prompt.
	sawRepo := os.Getenv("SAW_REPO")
	if sawRepo == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			publish("scout_failed", map[string]string{
				"run_id": runID,
				"error":  "cannot determine home directory: " + err.Error(),
			})
			return
		}
		sawRepo = filepath.Join(home, "code", "scout-and-wave")
	}

	scoutMdPath := filepath.Join(sawRepo, "prompts", "scout.md")
	scoutMdBytes, err := os.ReadFile(scoutMdPath)
	if err != nil {
		// Fall back to an inline prompt if scout.md is not found.
		scoutMdBytes = []byte("You are a Scout agent. Analyze the codebase and produce an IMPL doc.")
	}

	prompt := fmt.Sprintf("%s\n\n## Feature\n%s\n\n## IMPL Output Path\n%s\n",
		string(scoutMdBytes), feature, implOut)

	// Build CLI backend with --dangerously-skip-permissions.
	b := cli.New("", backend.Config{})
	runner := agent.NewRunner(b, nil)
	spec := &types.AgentSpec{Letter: "scout", Prompt: prompt}

	ctx := context.Background()

	onChunk := func(chunk string) {
		publish("scout_output", map[string]string{
			"run_id": runID,
			"chunk":  chunk,
		})
	}

	_, execErr := runner.ExecuteStreaming(ctx, spec, repoRoot, onChunk)
	if execErr != nil {
		publish("scout_failed", map[string]string{
			"run_id": runID,
			"error":  execErr.Error(),
		})
		return
	}

	publish("scout_complete", map[string]string{
		"run_id":    runID,
		"slug":      slug,
		"impl_path": implOut,
	})
}
