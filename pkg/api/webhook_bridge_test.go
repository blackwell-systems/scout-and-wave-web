package api

import (
	"context"
	"sync"
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/notify"
)

// mockAdapter records Send calls for verification.
type mockAdapter struct {
	name     string
	mu       sync.Mutex
	messages []notify.Message
	sendErr  error
}

func (m *mockAdapter) Name() string { return m.name }
func (m *mockAdapter) Send(_ context.Context, msg notify.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.messages = append(m.messages, msg)
	return m.sendErr
}

func TestDefaultFormatter_Format(t *testing.T) {
	f := DefaultFormatter{}
	event := notify.Event{
		Type:     "wave_complete",
		Severity: notify.SeverityInfo,
		Title:    "Wave 1 Complete",
		Body:     "All agents finished successfully.",
		Fields:   map[string]string{"slug": "my-feature"},
	}

	msg := f.Format(event)

	if msg.Text == "" {
		t.Fatal("expected non-empty text")
	}
	if !contains(msg.Text, "Wave 1 Complete") {
		t.Errorf("expected title in text, got: %s", msg.Text)
	}
	if !contains(msg.Text, "All agents finished successfully.") {
		t.Errorf("expected body in text, got: %s", msg.Text)
	}
	if !contains(msg.Text, "slug: my-feature") {
		t.Errorf("expected fields in text, got: %s", msg.Text)
	}
}

func TestDefaultFormatter_FormatNoBody(t *testing.T) {
	f := DefaultFormatter{}
	event := notify.Event{
		Type:     "test",
		Severity: notify.SeverityInfo,
		Title:    "Title Only",
	}

	msg := f.Format(event)

	if msg.Text != "Title Only" {
		t.Errorf("expected just title, got: %s", msg.Text)
	}
}

func TestWebhookBridge_HandleNotification_TranslatesEvent(t *testing.T) {
	mock := &mockAdapter{name: "test"}
	dispatcher := notify.NewDispatcher(mock)
	bridge := NewWebhookBridge(dispatcher)

	event := NotificationEvent{
		Type:     NotifyWaveComplete,
		Slug:     "my-feature",
		Title:    "Wave 1 Complete",
		Message:  "All agents finished.",
		Severity: "success",
	}

	bridge.HandleNotification(event)

	mock.mu.Lock()
	defer mock.mu.Unlock()

	if len(mock.messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(mock.messages))
	}

	msg := mock.messages[0]
	if !contains(msg.Text, "Wave 1 Complete") {
		t.Errorf("expected title in message text, got: %s", msg.Text)
	}
	if !contains(msg.Text, "All agents finished.") {
		t.Errorf("expected body in message text, got: %s", msg.Text)
	}
	if !contains(msg.Text, "slug: my-feature") {
		t.Errorf("expected slug field in message text, got: %s", msg.Text)
	}
}

func TestWebhookBridge_HandleNotification_SeverityMapping(t *testing.T) {
	tests := []struct {
		severity string
		want     notify.Severity
	}{
		{"info", notify.SeverityInfo},
		{"success", notify.SeverityInfo},
		{"warning", notify.SeverityWarning},
		{"error", notify.SeverityError},
		{"unknown", notify.SeverityInfo}, // defaults to info
	}

	for _, tt := range tests {
		t.Run(tt.severity, func(t *testing.T) {
			got, ok := severityMap[tt.severity]
			if tt.severity == "unknown" {
				if ok {
					t.Error("expected unknown severity not to be in map")
				}
				return
			}
			if !ok {
				t.Fatalf("severity %q not found in map", tt.severity)
			}
			if got != tt.want {
				t.Errorf("severity %q: got %v, want %v", tt.severity, got, tt.want)
			}
		})
	}
}

func TestWebhookBridge_NilSafe(t *testing.T) {
	// Should not panic on nil bridge
	var bridge *WebhookBridge
	bridge.HandleNotification(NotificationEvent{
		Type:    NotifyWaveComplete,
		Title:   "test",
		Message: "test",
	})

	// Should not panic on nil dispatcher
	bridge2 := &WebhookBridge{dispatcher: nil}
	bridge2.HandleNotification(NotificationEvent{
		Type:    NotifyWaveComplete,
		Title:   "test",
		Message: "test",
	})
}

func TestWebhookBridge_DispatchWithMultipleAdapters(t *testing.T) {
	mock1 := &mockAdapter{name: "adapter1"}
	mock2 := &mockAdapter{name: "adapter2"}
	dispatcher := notify.NewDispatcher(mock1, mock2)
	bridge := NewWebhookBridge(dispatcher)

	bridge.HandleNotification(NotificationEvent{
		Type:     NotifyAgentFailed,
		Slug:     "test-slug",
		Title:    "Agent B Failed",
		Message:  "Build error in pkg/foo",
		Severity: "error",
	})

	mock1.mu.Lock()
	count1 := len(mock1.messages)
	mock1.mu.Unlock()

	mock2.mu.Lock()
	count2 := len(mock2.messages)
	mock2.mu.Unlock()

	if count1 != 1 {
		t.Errorf("adapter1: expected 1 message, got %d", count1)
	}
	if count2 != 1 {
		t.Errorf("adapter2: expected 1 message, got %d", count2)
	}
}

// contains checks if substr is in s.
func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
