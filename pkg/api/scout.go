package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/result"
	"github.com/blackwell-systems/scout-and-wave-web/pkg/service"
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

// handleScoutRun handles POST /api/scout/run.
// Parses the JSON body, delegates to service.StartScout, and returns 202 with
// JSON {"run_id": "<runID>"}.
func (s *Server) handleScoutRun(w http.ResponseWriter, r *http.Request) {
	var req ScoutRunRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Feature == "" {
		http.Error(w, "feature is required", http.StatusBadRequest)
		return
	}

	deps := s.makeDeps()
	runID, err := service.StartScout(deps, req.Feature, req.Repo)
	var startResult result.Result[string]
	if err != nil {
		startResult = result.NewFailure[string]([]result.StructuredError{{
			Code:     "E001",
			Message:  err.Error(),
			Severity: "fatal",
		}})
	} else {
		startResult = result.NewSuccess(runID)
	}
	if !startResult.IsSuccess() {
		respondError(w, startResult.Errors[0].Message, http.StatusBadRequest)
		return
	}

	respondJSON(w, http.StatusAccepted, ScoutRunResponse{RunID: startResult.GetData()})
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

// handleScoutCancel handles POST /api/scout/{runID}/cancel.
func (s *Server) handleScoutCancel(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")
	deps := s.makeDeps()
	service.CancelScout(deps, runID)
	w.WriteHeader(http.StatusNoContent)
}

// handleScoutRerun handles POST /api/scout/{slug}/rerun.
// Re-runs the Scout agent for an existing slug, reusing the feature title from
// the IMPL manifest (or falling back to the slug itself). Returns 202 with a
// run_id that callers can use to subscribe via GET /api/scout/{runID}/events.
func (s *Server) handleScoutRerun(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	// Try to load feature title from manifest; fall back to slug.
	feature := slug
	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".yaml")
	if data, err := os.ReadFile(implPath); err == nil {
		// Quick extraction: look for "title:" line in YAML front matter.
		for _, line := range strings.Split(string(data), "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "title:") {
				val := strings.TrimPrefix(trimmed, "title:")
				val = strings.TrimSpace(val)
				val = strings.Trim(val, `"'`)
				if val != "" {
					feature = val
				}
				break
			}
		}
	}

	deps := s.makeDeps()
	runID, err := service.StartScout(deps, feature, "")
	var rerunResult result.Result[string]
	if err != nil {
		rerunResult = result.NewFailure[string]([]result.StructuredError{{
			Code:     "E001",
			Message:  err.Error(),
			Severity: "fatal",
		}})
	} else {
		rerunResult = result.NewSuccess(runID)
	}
	if !rerunResult.IsSuccess() {
		respondError(w, rerunResult.Errors[0].Message, http.StatusInternalServerError)
		return
	}

	respondJSON(w, http.StatusAccepted, ScoutRunResponse{RunID: rerunResult.GetData()})
}

// makeDeps constructs a service.Deps from Server state.
func (s *Server) makeDeps() service.Deps {
	publisher := NewSSEPublisher(s.broker, s.globalBroker)
	return service.Deps{
		RepoPath:  s.cfg.RepoPath,
		IMPLDir:   s.cfg.IMPLDir,
		Publisher: publisher,
		ConfigPath: func(repoPath string) string {
			return filepath.Join(repoPath, "saw.config.json")
		},
	}
}
