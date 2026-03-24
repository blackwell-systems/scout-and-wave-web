package service

// Deps holds shared dependencies injected into all service functions.
// This avoids passing the full Server struct into the service layer.
type Deps struct {
	// RepoPath is the default repository root path.
	RepoPath string
	// IMPLDir is the directory containing IMPL documents.
	IMPLDir string
	// Publisher is the event transport abstraction.
	Publisher EventPublisher
	// Deprecated: ConfigPath is no longer used by GetConfig/SaveConfig which
	// now delegate to config.Load/config.Save from the SDK. Kept to avoid
	// cascading changes to every test file that constructs Deps.
	ConfigPath func(repoPath string) string
}
