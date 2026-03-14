package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
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
	log.Printf("[chat] Starting chat session: slug=%s runID=%s message=%q historyLen=%d", slug, runID, req.Message, len(req.History))
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
	log.Printf("[chat] Client subscribed to events: runID=%s", runID)

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
			log.Printf("[chat] Client disconnected from events: runID=%s", runID)
			return
		}
	}
}

// runImplChatAgent runs a Claude agent that reads the IMPL doc and answers a question.
// Publishes chat_output, chat_complete, and chat_failed SSE events.
func (s *Server) runImplChatAgent(ctx context.Context, runID, slug, message string, history []ChatMessage) {
	brokerKey := "chat-" + runID
	chunkCount := 0
	publish := func(event string, data interface{}) {
		s.broker.Publish(brokerKey, SSEEvent{Event: event, Data: data})
	}

	log.Printf("[chat] Agent starting: runID=%s slug=%s", runID, slug)

	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".yaml")

	// Convert history to engine.ChatMessage format
	var engineHistory []engine.ChatMessage
	for _, msg := range history {
		engineHistory = append(engineHistory, engine.ChatMessage{
			Role:    msg.Role,
			Content: msg.Content,
		})
	}

	onChunk := func(chunk string) {
		chunkCount++
		log.Printf("[chat] Streaming chunk #%d: runID=%s len=%d", chunkCount, runID, len(chunk))
		publish("chat_output", map[string]string{"run_id": runID, "chunk": chunk})
	}

	// Locate SAW repo for prompt files.
	sawRepo := os.Getenv("SAW_REPO")
	if sawRepo == "" {
		home, _ := os.UserHomeDir()
		sawRepo = filepath.Join(home, "code", "scout-and-wave")
	}

	// Read saw.config.json fresh so model changes in Settings take effect immediately.
	chatModel := ""
	if cfgData, err := os.ReadFile(filepath.Join(s.cfg.RepoPath, "saw.config.json")); err == nil {
		var sawCfg SAWConfig
		if json.Unmarshal(cfgData, &sawCfg) == nil {
			chatModel = sawCfg.Agent.ChatModel
		}
	}

	log.Printf("[chat] Launching RunChat: runID=%s implPath=%s repoPath=%s historyLen=%d chatModel=%q", runID, implPath, s.cfg.RepoPath, len(engineHistory), chatModel)

	err := engine.RunChat(ctx, engine.RunChatOpts{
		IMPLPath:    implPath,
		RepoPath:    s.cfg.RepoPath,
		SAWRepoPath: sawRepo,
		History:     engineHistory,
		Message:     message,
		ChatModel:   chatModel,
	}, onChunk)

	if err != nil {
		if ctx.Err() != nil {
			log.Printf("[chat] Agent cancelled: runID=%s", runID)
			publish("chat_failed", map[string]string{"run_id": runID, "error": "cancelled"})
		} else {
			log.Printf("[chat] Agent failed: runID=%s error=%v", runID, err)
			publish("chat_failed", map[string]string{"run_id": runID, "error": err.Error()})
		}
		return
	}

	log.Printf("[chat] Agent completed successfully: runID=%s totalChunks=%d", runID, chunkCount)
	publish("chat_complete", map[string]string{"run_id": runID, "slug": slug})
}
