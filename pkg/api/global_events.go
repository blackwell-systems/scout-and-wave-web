package api

// global_events.go — Server-Sent Events for filesystem-level changes.
//
// Why this exists:
//
// The IMPL doc list can change without the web UI knowing about it. A CLI
// `/saw scout` run, a background agent, or an external file copy all write
// new IMPL docs to docs/IMPL/ — but the frontend only calls listImpls()
// on mount and after in-app scout runs via SSE completion events.
//
// This file adds:
//   - A filesystem watcher (fsnotify) that watches the configured IMPLDir
//   - A global SSE endpoint GET /api/events that every client subscribes to
//   - An "impl_list_updated" event broadcast whenever the IMPL dir changes
//
// The frontend subscribes once in App.tsx and calls listImpls() on each
// event, keeping the sidebar in sync with whatever writes IMPL docs.

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// globalBroker fans out impl_list_updated events to all connected clients.
type globalBroker struct {
	mu      sync.Mutex
	clients map[chan string]struct{}
}

func newGlobalBroker() *globalBroker {
	return &globalBroker{clients: make(map[chan string]struct{})}
}

func (b *globalBroker) subscribe() chan string {
	ch := make(chan string, 4)
	b.mu.Lock()
	b.clients[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *globalBroker) unsubscribe(ch chan string) {
	b.mu.Lock()
	delete(b.clients, ch)
	b.mu.Unlock()
}

func (b *globalBroker) broadcast(event string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.clients {
		select {
		case ch <- event:
		default:
		}
	}
}

// handleGlobalEvents is GET /api/events — a persistent SSE stream for
// global state changes (impl list, config, etc.).
func (s *Server) handleGlobalEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch := s.globalBroker.subscribe()
	defer s.globalBroker.unsubscribe(ch)

	// Send an initial heartbeat so the client knows the connection is live.
	fmt.Fprintf(w, "event: connected\ndata: {}\n\n")
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-ch:
			fmt.Fprintf(w, "event: %s\ndata: {}\n\n", event)
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		case <-ticker.C:
			// Keepalive ping to prevent proxy timeouts.
			fmt.Fprintf(w, ": ping\n\n")
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		}
	}
}

// startIMPLWatcher watches the IMPL directory and broadcasts
// "impl_list_updated" whenever a .yaml file is created or renamed into place.
func (s *Server) startIMPLWatcher(implDir string) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return
	}
	if err := watcher.Add(implDir); err != nil {
		watcher.Close()
		return
	}

	go func() {
		defer watcher.Close()
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				// Only care about creates and renames (new file written).
				if event.Has(fsnotify.Create) || event.Has(fsnotify.Rename) {
					s.globalBroker.broadcast("impl_list_updated")
				}
			case _, ok := <-watcher.Errors:
				if !ok {
					return
				}
			}
		}
	}()
}
