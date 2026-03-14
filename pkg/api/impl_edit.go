package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	engine "github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
)

// handleGetImplRaw serves GET /api/impl/{slug}/raw
// Returns the raw IMPL doc (YAML or markdown) as text/plain.
func (s *Server) handleGetImplRaw(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		http.Error(w, "missing slug", http.StatusBadRequest)
		return
	}

	// Search for IMPL doc in standard locations (same as handleGetImpl)
	searchDirs := []string{
		filepath.Join(s.cfg.RepoPath, "docs", "IMPL"),
		filepath.Join(s.cfg.RepoPath, "docs", "IMPL", "complete"),
	}

	var implPath string
	var found bool
	for _, dir := range searchDirs {
		for _, ext := range []string{".yaml"} {
			candidate := filepath.Join(dir, "IMPL-"+slug+ext)
			if _, err := os.Stat(candidate); err == nil {
				implPath = candidate
				found = true
				break
			}
		}
		if found {
			break
		}
	}

	if !found {
		http.Error(w, "IMPL doc not found", http.StatusNotFound)
		return
	}

	data, err := os.ReadFile(implPath)
	if err != nil {
		http.Error(w, "failed to read IMPL doc", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

// handlePutImplRaw serves PUT /api/impl/{slug}/raw
// Accepts raw markdown body and atomically writes it to the IMPL doc.
func (s *Server) handlePutImplRaw(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		http.Error(w, "missing slug", http.StatusBadRequest)
		return
	}
	if r.ContentLength == 0 {
		http.Error(w, "empty body", http.StatusBadRequest)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 10<<20)) // 10MB limit
	if err != nil {
		http.Error(w, "failed to read body", http.StatusInternalServerError)
		return
	}
	if len(body) == 0 {
		http.Error(w, "empty body", http.StatusBadRequest)
		return
	}
	// Ensure IMPL directory exists
	if err := os.MkdirAll(s.cfg.IMPLDir, 0755); err != nil {
		http.Error(w, "failed to create IMPL directory", http.StatusInternalServerError)
		return
	}

	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".yaml")
	// Atomic write via temp file + rename
	tmpFile, err := os.CreateTemp(s.cfg.IMPLDir, "impl-edit-*.yaml.tmp")
	if err != nil {
		http.Error(w, "failed to create temp file", http.StatusInternalServerError)
		return
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath) // clean up if rename fails
	if _, err := tmpFile.Write(body); err != nil {
		tmpFile.Close()
		http.Error(w, "failed to write temp file", http.StatusInternalServerError)
		return
	}
	if err := tmpFile.Close(); err != nil {
		http.Error(w, "failed to close temp file", http.StatusInternalServerError)
		return
	}
	if err := os.Rename(tmpPath, implPath); err != nil {
		http.Error(w, "failed to save IMPL doc", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// handleImplRevise handles POST /api/impl/{slug}/revise.
// Accepts {"feedback":"..."}, launches a Claude agent to revise the IMPL doc
// in place, and returns 202 with {"run_id":"..."} for SSE subscription.
func (s *Server) handleImplRevise(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		http.Error(w, "missing slug", http.StatusBadRequest)
		return
	}
	var req struct {
		Feedback string `json:"feedback"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Feedback == "" {
		http.Error(w, "feedback is required", http.StatusBadRequest)
		return
	}

	runID := fmt.Sprintf("%d", time.Now().UnixNano())
	ctx, cancel := context.WithCancel(context.Background())
	s.reviseCancels.Store(runID, cancel)
	go func() {
		defer s.reviseCancels.Delete(runID)
		defer cancel()
		s.runImplReviseAgent(ctx, runID, slug, req.Feedback)
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"run_id": runID}) //nolint:errcheck
}

// handleImplReviseEvents handles GET /api/impl/{slug}/revise/{runID}/events.
// Streams revise_output, revise_complete, and revise_failed SSE events.
func (s *Server) handleImplReviseEvents(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")
	brokerKey := "revise-" + runID

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

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

// handleImplReviseCancel handles POST /api/impl/{slug}/revise/{runID}/cancel.
func (s *Server) handleImplReviseCancel(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")
	if v, ok := s.reviseCancels.Load(runID); ok {
		if cancel, ok := v.(context.CancelFunc); ok {
			cancel()
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// runImplReviseAgent runs a Claude agent that reads and revises the IMPL doc.
// Uses engine.RunScout with a revise-specific system prompt.
func (s *Server) runImplReviseAgent(ctx context.Context, runID, slug, feedback string) {
	brokerKey := "revise-" + runID
	publish := func(event string, data interface{}) {
		s.broker.Publish(brokerKey, SSEEvent{Event: event, Data: data})
	}

	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".yaml")

	systemPrompt := fmt.Sprintf(`You are an expert software architect revising a Scout-and-Wave IMPL doc.

The IMPL doc is at: %s

The user has requested these changes:
%s

Instructions:
- Read the current IMPL doc using the Read tool
- Make exactly the changes the user requested
- Write the complete updated file back using the Write tool
- Preserve all sections that don't need modification
- Keep the same format and structure
- Do not output commentary — just revise and save the file`, implPath, feedback)

	onChunk := func(chunk string) {
		publish("revise_output", map[string]string{"run_id": runID, "chunk": chunk})
	}

	// Locate SAW repo for prompt files.
	sawRepo := os.Getenv("SAW_REPO")
	if sawRepo == "" {
		home, _ := os.UserHomeDir()
		sawRepo = filepath.Join(home, "code", "scout-and-wave")
	}

	err := engine.RunScout(ctx, engine.RunScoutOpts{
		Feature:     systemPrompt,
		RepoPath:    s.cfg.RepoPath,
		SAWRepoPath: sawRepo,
		IMPLOutPath: implPath,
	}, onChunk)

	if err != nil {
		if ctx.Err() != nil {
			publish("revise_cancelled", map[string]string{"run_id": runID})
		} else {
			publish("revise_failed", map[string]string{"run_id": runID, "error": err.Error()})
		}
		return
	}

	publish("revise_complete", map[string]string{"run_id": runID, "slug": slug})
}
