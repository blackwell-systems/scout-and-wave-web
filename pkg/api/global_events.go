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
//   - A filesystem watcher (fsnotify) that watches IMPL dirs across all configured repos
//   - A global SSE endpoint GET /api/events that every client subscribes to
//   - An "impl_list_updated" event broadcast whenever the IMPL dir changes
//
// The frontend subscribes once in App.tsx and calls listImpls() on each
// event, keeping the sidebar in sync with whatever writes IMPL docs.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
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
	ch := make(chan string, 16) // Increased buffer to handle concurrent broadcasts
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

// broadcastJSON marshals data to JSON and broadcasts it as an SSE event.
// The format sent is: event: <eventType>\ndata: <json>\n\n
func (b *globalBroker) broadcastJSON(eventType string, data interface{}) {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return
	}
	// Encode as "eventType:json_payload" so handleGlobalEvents can parse it
	payload := fmt.Sprintf("%s:%s", eventType, string(jsonData))
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.clients {
		select {
		case ch <- payload:
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
			// Parse event format: either simple "event_name" or "event_type:json_payload"
			if idx := findColon(event); idx != -1 {
				eventType := event[:idx]
				jsonData := event[idx+1:]
				fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, jsonData)
			} else {
				// Simple event with empty data
				fmt.Fprintf(w, "event: %s\ndata: {}\n\n", event)
			}
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

// startIMPLWatcher watches IMPL directories across all configured repos and
// broadcasts "impl_list_updated" whenever a .yaml file is created, renamed,
// or removed. This ensures the frontend stays in sync even when CLI Scout
// agents write IMPL docs to repos other than the server's startup repo.
func (s *Server) startIMPLWatcher(fallbackDir string) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return
	}

	// Collect IMPL directories from all configured repos.
	dirs := s.implWatchDirs(fallbackDir)
	if len(dirs) == 0 {
		watcher.Close()
		return
	}

	added := 0
	for _, dir := range dirs {
		if err := watcher.Add(dir); err == nil {
			added++
		}
	}
	if added == 0 {
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
				// Watch for creates, renames, and removes (archival/deletion).
				if event.Has(fsnotify.Create) || event.Has(fsnotify.Rename) || event.Has(fsnotify.Remove) {
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

// implWatchDirs returns all IMPL directories that should be watched,
// mirroring the multi-repo scanning logic in handleListImpls.
func (s *Server) implWatchDirs(fallbackDir string) []string {
	repos := s.getConfiguredRepos()

	seen := make(map[string]struct{})
	var dirs []string
	for _, repo := range repos {
		for _, sub := range []string{"docs/IMPL", "docs/IMPL/complete"} {
			dir := filepath.Join(repo.Path, sub)
			if _, err := os.Stat(dir); err == nil {
				if _, ok := seen[dir]; !ok {
					seen[dir] = struct{}{}
					dirs = append(dirs, dir)
				}
			}
		}
	}

	// Fallback: if no repos configured or none had IMPL dirs, use the startup dir.
	if len(dirs) == 0 {
		if _, err := os.Stat(fallbackDir); err == nil {
			dirs = append(dirs, fallbackDir)
		}
	}
	return dirs
}

// findColon returns the index of the first ':' in s, or -1 if not found.
func findColon(s string) int {
	for i := 0; i < len(s); i++ {
		if s[i] == ':' {
			return i
		}
	}
	return -1
}
