package api

import "sync"

// NotificationBus is a central hub that handlers call to emit user-facing
// notifications. The bus broadcasts events to all SSE clients via the
// existing globalBroker.
//
// Design:
//   - Handlers call Notify() when something worth notifying the user occurs
//     (wave complete, build failures, etc.)
//   - The bus formats the NotificationEvent and broadcasts it to all SSE
//     clients via globalBroker.broadcastJSON()
//   - The frontend (/api/events listener) receives these events and decides
//     whether to show a toast, browser notification, or both based on user
//     preferences stored in saw.config.json
//
// Concurrency:
//   - Notify() is safe to call from multiple goroutines (wave runners, merge
//     handlers, etc.) because globalBroker.broadcastJSON() uses internal locking.
type NotificationBus struct {
	broker *globalBroker
	mu     sync.Mutex // protects concurrent Notify calls
}

// NewNotificationBus creates a new NotificationBus that broadcasts to the
// given globalBroker.
func NewNotificationBus(broker *globalBroker) *NotificationBus {
	return &NotificationBus{
		broker: broker,
	}
}

// Notify broadcasts a notification event to all connected SSE clients.
// The event is marshaled to JSON and sent with the "notification" event type.
// This method is safe to call concurrently from multiple goroutines.
func (nb *NotificationBus) Notify(event NotificationEvent) {
	nb.mu.Lock()
	defer nb.mu.Unlock()
	
	// Broadcast the notification event as JSON via the global broker
	nb.broker.broadcastJSON("notification", event)
}
