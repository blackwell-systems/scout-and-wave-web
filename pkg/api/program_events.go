package api

// program_events.go — Server-Sent Events for program lifecycle events.
//
// Why this exists:
//
// Programs execute asynchronously across multiple tiers, with each tier
// containing multiple IMPLs running in parallel. The frontend needs real-time
// updates on tier transitions, IMPL completion, contract freezes, and blocking
// conditions to update the ProgramBoard UI.
//
// This file adds:
//   - Event name constants for 7 program lifecycle events
//   - ProgramPublisher — a typed helper that wraps globalBroker.broadcastJSON
//   - GET /api/program/events — SSE endpoint filtered to program_* events only

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Program SSE event names. All events are broadcast through the global broker
// and filtered by clients subscribing to /api/program/events.
const (
	ProgramEventTierStarted    = "program_tier_started"
	ProgramEventTierComplete   = "program_tier_complete"
	ProgramEventImplStarted    = "program_impl_started"
	ProgramEventImplComplete   = "program_impl_complete"
	ProgramEventContractFrozen = "program_contract_frozen"
	ProgramEventComplete       = "program_complete"
	ProgramEventBlocked        = "program_blocked"
)

// ProgramPublisher is a function type that publishes program lifecycle events.
// It wraps globalBroker.broadcastJSON to provide a cleaner API for program runners.
type ProgramPublisher func(event string, data interface{})

// newProgramPublisher creates a ProgramPublisher that broadcasts events through
// the existing globalBroker. This ensures program events reach all connected clients
// on both /api/events and /api/program/events.
func newProgramPublisher(broker *globalBroker) ProgramPublisher {
	return func(event string, data interface{}) {
		broker.broadcastJSON(event, data)
	}
}

// handleProgramEvents is GET /api/program/events — a persistent SSE stream for
// program lifecycle events. Filters the global event stream to only program_* events.
func (s *Server) handleProgramEvents(w http.ResponseWriter, r *http.Request) {
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
			// Parse event format: "event_type:json_payload"
			// Filter to only program_* events
			if idx := findColon(event); idx != -1 {
				eventType := event[:idx]
				// Only forward program_* events to this endpoint
				if strings.HasPrefix(eventType, "program_") {
					jsonData := event[idx+1:]
					fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, jsonData)
					if f, ok := w.(http.Flusher); ok {
						f.Flush()
					}
				}
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
