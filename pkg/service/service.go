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
	// ConfigPath returns the path to saw.config.json for a given repo.
	ConfigPath func(repoPath string) string
}
