package api

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestProgramEventConstants verifies all 7 program event name constants are defined.
func TestProgramEventConstants(t *testing.T) {
	tests := []struct {
		name     string
		constant string
		expected string
	}{
		{"TierStarted", ProgramEventTierStarted, "program_tier_started"},
		{"TierComplete", ProgramEventTierComplete, "program_tier_complete"},
		{"ImplStarted", ProgramEventImplStarted, "program_impl_started"},
		{"ImplComplete", ProgramEventImplComplete, "program_impl_complete"},
		{"ContractFrozen", ProgramEventContractFrozen, "program_contract_frozen"},
		{"Complete", ProgramEventComplete, "program_complete"},
		{"Blocked", ProgramEventBlocked, "program_blocked"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.constant != tt.expected {
				t.Errorf("constant %s = %q, want %q", tt.name, tt.constant, tt.expected)
			}
		})
	}
}

// TestNewProgramPublisher verifies the publisher broadcasts events correctly.
func TestNewProgramPublisher(t *testing.T) {
	broker := newGlobalBroker()
	publisher := newProgramPublisher(broker)

	// Subscribe a test client
	ch := broker.subscribe()
	defer broker.unsubscribe(ch)

	// Publish a test event
	testData := map[string]interface{}{
		"program_slug": "test-program",
		"tier":         1,
	}
	publisher(ProgramEventTierStarted, testData)

	// Verify the event was broadcast
	select {
	case event := <-ch:
		if !strings.HasPrefix(event, "program_tier_started:") {
			t.Errorf("expected event to start with 'program_tier_started:', got %q", event)
		}
		if !strings.Contains(event, "test-program") {
			t.Errorf("expected event to contain 'test-program', got %q", event)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timeout waiting for broadcast")
	}
}

// TestHandleProgramEvents_Connection verifies SSE headers and initial heartbeat.
func TestHandleProgramEvents_Connection(t *testing.T) {
	s := &Server{
		globalBroker: newGlobalBroker(),
	}

	req := httptest.NewRequest("GET", "/api/program/events", nil)
	ctx, cancel := context.WithTimeout(req.Context(), 200*time.Millisecond)
	defer cancel()
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()

	// Run handler in goroutine since it blocks
	done := make(chan struct{})
	go func() {
		s.handleProgramEvents(rec, req)
		close(done)
	}()

	// Wait for handler to complete or timeout
	<-done

	// Verify SSE headers
	if ct := rec.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("Content-Type = %q, want 'text/event-stream'", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("Cache-Control = %q, want 'no-cache'", cc)
	}
	if conn := rec.Header().Get("Connection"); conn != "keep-alive" {
		t.Errorf("Connection = %q, want 'keep-alive'", conn)
	}

	// Verify initial heartbeat
	body := rec.Body.String()
	if !strings.Contains(body, "event: connected") {
		t.Errorf("expected initial 'connected' event, got body: %q", body)
	}
}

// TestHandleProgramEvents_Filtering verifies only program_* events are forwarded.
func TestHandleProgramEvents_Filtering(t *testing.T) {
	s := &Server{
		globalBroker: newGlobalBroker(),
	}

	req := httptest.NewRequest("GET", "/api/program/events", nil)
	ctx, cancel := context.WithTimeout(req.Context(), 500*time.Millisecond)
	defer cancel()
	req = req.WithContext(ctx)

	rec := newStreamRecorder()

	// Run handler in goroutine
	done := make(chan struct{})
	go func() {
		s.handleProgramEvents(rec, req)
		close(done)
	}()

	// Give time for connection to establish
	time.Sleep(50 * time.Millisecond)

	// Broadcast both program and non-program events
	publisher := newProgramPublisher(s.globalBroker)
	publisher(ProgramEventTierStarted, map[string]string{"program_slug": "test"})
	s.globalBroker.broadcast("impl_list_updated") // Should be filtered out

	// Give time for events to be processed
	time.Sleep(100 * time.Millisecond)

	<-done

	body := rec.Body.String()
	// Should contain program event
	if !strings.Contains(body, "program_tier_started") {
		t.Errorf("expected program_tier_started event in body: %q", body)
	}
	// Should NOT contain impl_list_updated (non-program event)
	if strings.Contains(body, "impl_list_updated") {
		t.Errorf("expected impl_list_updated to be filtered out, got body: %q", body)
	}
}

// streamRecorder implements http.ResponseWriter and http.Flusher for SSE testing.
type streamRecorder struct {
	*httptest.ResponseRecorder
}

func newStreamRecorder() *streamRecorder {
	return &streamRecorder{
		ResponseRecorder: httptest.NewRecorder(),
	}
}

func (s *streamRecorder) Flush() {
	// No-op for testing
}
