package api

import (
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestNotificationBus_Notify verifies that calling Notify broadcasts to subscribed clients.
func TestNotificationBus_Notify(t *testing.T) {
	broker := newGlobalBroker()
	bus := NewNotificationBus(broker)

	// Subscribe a client
	ch := broker.subscribe()
	defer broker.unsubscribe(ch)

	// Send a notification
	event := NotificationEvent{
		Type:     NotifyWaveComplete,
		Slug:     "test-wave",
		Title:    "Wave Complete",
		Message:  "All agents completed successfully",
		Severity: "success",
	}

	// Run notify in a goroutine and capture the result
	done := make(chan bool)
	go func() {
		bus.Notify(event)
		done <- true
	}()

	// Wait for the notification to be sent
	<-done

	// Receive the broadcast
	select {
	case msg := <-ch:
		// Message should be in format "notification:json"
		if !strings.HasPrefix(msg, "notification:") {
			t.Fatalf("Expected message to start with 'notification:', got: %s", msg)
		}

		// Extract and parse the JSON
		jsonStr := strings.TrimPrefix(msg, "notification:")
		var received NotificationEvent
		if err := json.Unmarshal([]byte(jsonStr), &received); err != nil {
			t.Fatalf("Failed to unmarshal notification JSON: %v", err)
		}

		// Verify the fields
		if received.Type != event.Type {
			t.Errorf("Expected type %s, got %s", event.Type, received.Type)
		}
		if received.Slug != event.Slug {
			t.Errorf("Expected slug %s, got %s", event.Slug, received.Slug)
		}
		if received.Title != event.Title {
			t.Errorf("Expected title %s, got %s", event.Title, received.Title)
		}
		if received.Message != event.Message {
			t.Errorf("Expected message %s, got %s", event.Message, received.Message)
		}
		if received.Severity != event.Severity {
			t.Errorf("Expected severity %s, got %s", event.Severity, received.Severity)
		}

	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for notification")
	}
}

// TestNotificationBus_NotifyJSON verifies the SSE data payload is valid JSON.
func TestNotificationBus_NotifyJSON(t *testing.T) {
	broker := newGlobalBroker()
	bus := NewNotificationBus(broker)

	ch := broker.subscribe()
	defer broker.unsubscribe(ch)

	event := NotificationEvent{
		Type:     NotifyBuildVerifyFail,
		Slug:     "failed-build",
		Title:    "Build Failed",
		Message:  "Compilation errors detected",
		Severity: "error",
	}

	go bus.Notify(event)

	select {
	case msg := <-ch:
		// Extract JSON part
		parts := strings.SplitN(msg, ":", 2)
		if len(parts) != 2 {
			t.Fatalf("Expected format 'event:json', got: %s", msg)
		}

		jsonStr := parts[1]

		// Verify it's valid JSON
		var parsed map[string]interface{}
		if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
			t.Fatalf("Invalid JSON in notification: %v\nJSON: %s", err, jsonStr)
		}

		// Check required fields exist
		if _, ok := parsed["type"]; !ok {
			t.Error("Missing 'type' field in JSON")
		}
		if _, ok := parsed["slug"]; !ok {
			t.Error("Missing 'slug' field in JSON")
		}
		if _, ok := parsed["title"]; !ok {
			t.Error("Missing 'title' field in JSON")
		}
		if _, ok := parsed["message"]; !ok {
			t.Error("Missing 'message' field in JSON")
		}
		if _, ok := parsed["severity"]; !ok {
			t.Error("Missing 'severity' field in JSON")
		}

	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for notification")
	}
}

// TestNotificationBus_ConcurrentNotify verifies thread safety.
func TestNotificationBus_ConcurrentNotify(t *testing.T) {
	broker := newGlobalBroker()
	bus := NewNotificationBus(broker)

	ch := broker.subscribe()
	defer broker.unsubscribe(ch)

	// Send multiple notifications concurrently
	const numNotifications = 10
	var wg sync.WaitGroup
	
	// Start receiving in the background before sending
	received := make(chan int, 1)
	go func() {
		count := 0
		timeout := time.After(2 * time.Second)
		for {
			select {
			case msg := <-ch:
				if strings.HasPrefix(msg, "notification:") {
					count++
					if count >= numNotifications {
						received <- count
						return
					}
				}
			case <-timeout:
				received <- count
				return
			}
		}
	}()

	// Now send notifications concurrently
	wg.Add(numNotifications)
	for i := 0; i < numNotifications; i++ {
		go func(idx int) {
			defer wg.Done()
			event := NotificationEvent{
				Type:     NotifyWaveComplete,
				Slug:     "test-wave",
				Title:    "Concurrent Test",
				Message:  "Testing concurrent notifications",
				Severity: "info",
			}
			bus.Notify(event)
		}(i)
	}

	// Wait for all to be sent
	wg.Wait()
	
	// Get the count of received notifications
	count := <-received

	if count != numNotifications {
		t.Errorf("Expected to receive %d notifications, got %d", numNotifications, count)
	}
}

// TestGlobalBroker_BroadcastJSON verifies broadcastJSON sends event+data fields.
func TestGlobalBroker_BroadcastJSON(t *testing.T) {
	broker := newGlobalBroker()

	ch := broker.subscribe()
	defer broker.unsubscribe(ch)

	testData := map[string]interface{}{
		"type":     "test_event",
		"message":  "Hello, World!",
		"count":    42,
		"success":  true,
	}

	go broker.broadcastJSON("test_event", testData)

	select {
	case msg := <-ch:
		// Verify format is "event_type:json_data"
		parts := strings.SplitN(msg, ":", 2)
		if len(parts) != 2 {
			t.Fatalf("Expected format 'event:json', got: %s", msg)
		}

		eventType := parts[0]
		jsonData := parts[1]

		if eventType != "test_event" {
			t.Errorf("Expected event type 'test_event', got: %s", eventType)
		}

		// Parse and verify JSON
		var parsed map[string]interface{}
		if err := json.Unmarshal([]byte(jsonData), &parsed); err != nil {
			t.Fatalf("Failed to parse JSON: %v", err)
		}

		if parsed["type"] != "test_event" {
			t.Errorf("Expected type 'test_event', got: %v", parsed["type"])
		}
		if parsed["message"] != "Hello, World!" {
			t.Errorf("Expected message 'Hello, World!', got: %v", parsed["message"])
		}
		if parsed["count"].(float64) != 42 {
			t.Errorf("Expected count 42, got: %v", parsed["count"])
		}
		if parsed["success"] != true {
			t.Errorf("Expected success true, got: %v", parsed["success"])
		}

	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for broadcast")
	}
}

// TestGlobalBroker_BroadcastJSON_MultipleClients verifies all clients receive the JSON event.
func TestGlobalBroker_BroadcastJSON_MultipleClients(t *testing.T) {
	broker := newGlobalBroker()

	const numClients = 5
	clients := make([]chan string, numClients)
	for i := 0; i < numClients; i++ {
		clients[i] = broker.subscribe()
		defer broker.unsubscribe(clients[i])
	}

	testData := NotificationEvent{
		Type:     NotifyMergeComplete,
		Slug:     "test-merge",
		Title:    "Merge Complete",
		Message:  "All agents merged successfully",
		Severity: "success",
	}

	go broker.broadcastJSON("notification", testData)

	// Each client should receive the notification
	for i := 0; i < numClients; i++ {
		select {
		case msg := <-clients[i]:
			if !strings.HasPrefix(msg, "notification:") {
				t.Errorf("Client %d: expected notification event, got: %s", i, msg)
			}
			// Verify JSON is parseable
			jsonStr := strings.TrimPrefix(msg, "notification:")
			var parsed NotificationEvent
			if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
				t.Errorf("Client %d: failed to parse JSON: %v", i, err)
			}
			if parsed.Type != testData.Type {
				t.Errorf("Client %d: expected type %s, got %s", i, testData.Type, parsed.Type)
			}
		case <-time.After(1 * time.Second):
			t.Errorf("Client %d: timeout waiting for notification", i)
		}
	}
}
