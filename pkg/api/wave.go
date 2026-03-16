package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
)

// sseBroker manages SSE subscriptions per IMPL slug.
// Goroutine-safe via mu.
type sseBroker struct {
	mu      sync.Mutex
	clients map[string][]chan SSEEvent // slug -> list of subscriber channels
}

// subscribe registers a new channel for the given slug and returns it.
func (b *sseBroker) subscribe(slug string) chan SSEEvent {
	ch := make(chan SSEEvent, 2048)
	b.mu.Lock()
	b.clients[slug] = append(b.clients[slug], ch)
	b.mu.Unlock()
	return ch
}

// unsubscribe removes the channel from the slug's subscriber list.
func (b *sseBroker) unsubscribe(slug string, ch chan SSEEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()
	chans := b.clients[slug]
	for i, c := range chans {
		if c == ch {
			b.clients[slug] = append(chans[:i], chans[i+1:]...)
			break
		}
	}
}

// Publish sends ev to all active subscribers for slug.
// Safe to call from any goroutine. Non-blocking: drops to slow clients.
func (b *sseBroker) Publish(slug string, ev SSEEvent) {
	b.mu.Lock()
	chans := make([]chan SSEEvent, len(b.clients[slug]))
	copy(chans, b.clients[slug])
	b.mu.Unlock()

	for _, ch := range chans {
		select {
		case ch <- ev:
		default:
			// drop if channel is full (slow client)
		}
	}
}

// handleWaveEvents serves GET /api/wave/{slug}/events.
// Upgrades the connection to SSE, subscribes to the broker for slug,
// and streams SSEEvents until the client disconnects.
func (s *Server) handleWaveEvents(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	ch := s.broker.subscribe(slug)
	defer s.broker.unsubscribe(slug, ch)

	for {
		select {
		case ev := <-ch:
			data, err := json.Marshal(ev.Data)
			if err != nil {
				// Skip events we can't marshal.
				continue
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Event, data)
			flusher.Flush()
			if ev.Event == "agent_tool_call" {
				s.ParseAndEmitProgress(ev, slug)
			}
		case <-r.Context().Done():
			return
		}
	}
}
