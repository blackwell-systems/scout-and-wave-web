package api

// NotificationEventType enumerates the events that produce user-facing notifications.
type NotificationEventType string

const (
	NotifyWaveComplete       NotificationEventType = "wave_complete"
	NotifyAgentFailed        NotificationEventType = "agent_failed"
	NotifyMergeComplete      NotificationEventType = "merge_complete"
	NotifyMergeFailed        NotificationEventType = "merge_failed"
	NotifyScaffoldComplete   NotificationEventType = "scaffold_complete"
	NotifyBuildVerifyPass    NotificationEventType = "build_verify_pass"
	NotifyBuildVerifyFail    NotificationEventType = "build_verify_fail"
	NotifyIMPLComplete       NotificationEventType = "impl_complete"
	NotifyRunFailed          NotificationEventType = "run_failed"
)

// NotificationEvent is the payload published to the notification bus and
// broadcast to SSE clients as a "notification" event.
type NotificationEvent struct {
	Type     NotificationEventType `json:"type"`
	Slug     string                `json:"slug"`
	Title    string                `json:"title"`
	Message  string                `json:"message"`
	// Severity: "info", "success", "warning", "error"
	Severity string `json:"severity"`
}

// NotificationPreferences controls which notification types are enabled.
// Stored in saw.config.json under the "notifications" key.
type NotificationPreferences struct {
	Enabled       bool                    `json:"enabled"`
	MutedTypes    []NotificationEventType `json:"muted_types,omitempty"`
	BrowserNotify bool                    `json:"browser_notify"`
	ToastNotify   bool                    `json:"toast_notify"`
}
