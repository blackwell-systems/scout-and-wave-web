package api

import (
	"context"
	"log"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/notify"
)

// DefaultFormatter produces plain-text Messages from Events.
// Each adapter handles its own rich formatting internally.
type DefaultFormatter struct{}

// Format returns a plain-text Message with the event title and body.
func (f DefaultFormatter) Format(event notify.Event) notify.Message {
	text := event.Title
	if event.Body != "" {
		text += "\n" + event.Body
	}
	if len(event.Fields) > 0 {
		for k, v := range event.Fields {
			text += "\n" + k + ": " + v
		}
	}
	return notify.Message{Text: text}
}

// WebhookBridge translates NotificationBus events into notify.Event values
// and dispatches them via a notify.Dispatcher.
type WebhookBridge struct {
	dispatcher *notify.Dispatcher
	formatter  notify.Formatter
}

// NewWebhookBridge creates a WebhookBridge backed by the given Dispatcher.
// It uses a DefaultFormatter for plain-text message formatting.
func NewWebhookBridge(dispatcher *notify.Dispatcher) *WebhookBridge {
	return &WebhookBridge{
		dispatcher: dispatcher,
		formatter:  DefaultFormatter{},
	}
}

// severityMap translates string severity values from NotificationEvent
// to the typed notify.Severity constants.
var severityMap = map[string]notify.Severity{
	"info":    notify.SeverityInfo,
	"success": notify.SeverityInfo, // no SeveritySuccess; map to info
	"warning": notify.SeverityWarning,
	"error":   notify.SeverityError,
}

// HandleNotification translates a NotificationEvent into a notify.Event
// and dispatches it to all registered webhook adapters.
func (wb *WebhookBridge) HandleNotification(event NotificationEvent) {
	if wb == nil || wb.dispatcher == nil {
		return
	}

	sev, ok := severityMap[event.Severity]
	if !ok {
		sev = notify.SeverityInfo
	}

	evt := notify.Event{
		Type:      string(event.Type),
		Severity:  sev,
		Title:     event.Title,
		Body:      event.Message,
		Fields:    map[string]string{"slug": event.Slug},
		Timestamp: time.Now(),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := wb.dispatcher.Dispatch(ctx, evt, wb.formatter); err != nil {
		log.Printf("webhook dispatch error: %v", err)
	}
}
