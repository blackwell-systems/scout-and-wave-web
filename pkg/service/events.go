package service

// Event represents a typed event with a channel, event name, and data payload.
type Event struct {
	Channel string
	Name    string
	Data    interface{}
}

// EventPublisher abstracts event delivery from transport (SSE, Wails, etc.).
type EventPublisher interface {
	// Publish sends an event to all subscribers on the given channel.
	Publish(channel string, event Event)
	// Subscribe returns a channel that receives events for the given channel,
	// and a cancel function to unsubscribe.
	Subscribe(channel string) (<-chan Event, func())
}
