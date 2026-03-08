package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	engine "github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
)

// handleImplChat handles POST /api/impl/{slug}/chat.
// Body: {"message":"...", "history":[{"role":"user"|"assistant","content":"..."},...]}
// Starts a Claude agent with the IMPL doc as context. Streams response via SSE.
// Returns {"run_id":"..."} immediately; client subscribes to /api/impl/{slug}/chat/{runID}/events
func (s *Server) handleImplChat(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		http.Error(w, "missing slug", http.StatusBadRequest)
		return
	}

	var req ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Message == "" {
		http.Error(w, "message is required", http.StatusBadRequest)
		return
	}

	runID := fmt.Sprintf("%d", time.Now().UnixNano())
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		defer cancel()
		s.runImplChatAgent(ctx, runID, slug, req.Message, req.History)
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(ChatRunResponse{RunID: runID}) //nolint:errcheck
}

// handleImplChatEvents handles GET /api/impl/{slug}/chat/{runID}/events.
// SSE events: chat_output (chunk), chat_complete (final), chat_failed (error)
func (s *Server) handleImplChatEvents(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")
	brokerKey := "chat-" + runID

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

// runImplChatAgent runs a Claude agent that reads the IMPL doc and answers a question.
// Publishes chat_output, chat_complete, and chat_failed SSE events.
func (s *Server) runImplChatAgent(ctx context.Context, runID, slug, message string, history []ChatMessage) {
	brokerKey := "chat-" + runID
	publish := func(event string, data interface{}) {
		s.broker.Publish(brokerKey, SSEEvent{Event: event, Data: data})
	}

	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".md")

	// Format history for the system prompt
	var historyLines []string
	for _, msg := range history {
		historyLines = append(historyLines, fmt.Sprintf("%s: %s", msg.Role, msg.Content))
	}
	formattedHistory := strings.Join(historyLines, "\n")

	systemPrompt := fmt.Sprintf(`You are an expert software architect answering questions about a Scout-and-Wave IMPL doc.
Read the IMPL doc at: %s
Use the Read tool to read it, then answer the user's question concisely.
You MUST NOT modify the IMPL doc or any source files. Read-only.
Previous conversation:
%s
User question: %s`, implPath, formattedHistory, message)

	onChunk := func(chunk string) {
		publish("chat_output", map[string]string{"run_id": runID, "chunk": chunk})
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
			publish("chat_failed", map[string]string{"run_id": runID, "error": "cancelled"})
		} else {
			publish("chat_failed", map[string]string{"run_id": runID, "error": err.Error()})
		}
		return
	}

	publish("chat_complete", map[string]string{"run_id": runID, "slug": slug})
}
