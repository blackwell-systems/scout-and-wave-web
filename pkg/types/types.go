// Package types defines the shared data types for the Scout-and-Wave protocol:
// protocol states, IMPL doc structure, agent specifications, wave definitions,
// and completion report formats. All other packages in this module import types
// rather than defining their own protocol structs.
package types

// State represents the state of the protocol state machine
type State int

const (
	ScoutPending State = iota // initial state: Scout agent running (SCOUT_PENDING)
	NotSuitable
	Reviewed
	ScaffoldPending // Scaffold agent creating type scaffold files
	WavePending
	WaveExecuting
	WaveMerging // Orchestrator merging worktrees
	WaveVerified
	Blocked // Agent failure or verification failure; requires resolution
	Complete
)

// String returns the string representation of the State
func (s State) String() string {
	switch s {
	case ScoutPending:
		return "ScoutPending"
	case NotSuitable:
		return "NotSuitable"
	case Reviewed:
		return "Reviewed"
	case ScaffoldPending:
		return "ScaffoldPending"
	case WavePending:
		return "WavePending"
	case WaveExecuting:
		return "WaveExecuting"
	case WaveMerging:
		return "WaveMerging"
	case WaveVerified:
		return "WaveVerified"
	case Blocked:
		return "Blocked"
	case Complete:
		return "Complete"
	default:
		return "Unknown"
	}
}

// CompletionStatus represents the completion status of an agent's work
type CompletionStatus string

const (
	StatusComplete CompletionStatus = "complete"
	StatusPartial  CompletionStatus = "partial"
	StatusBlocked  CompletionStatus = "blocked"
)

// IMPLDoc is the parsed representation of an IMPL markdown document
type IMPLDoc struct {
	FeatureName   string
	Status        string
	TestCommand   string            // post-merge verification command (e.g. "go test ./...")
	LintCommand   string            // check-mode lint command (e.g. "go vet ./...")
	Waves         []Wave
	FileOwnership map[string]string // file path -> agent letter
}

// Wave represents one wave of parallel agents
type Wave struct {
	Number int
	Agents []AgentSpec
}

// AgentSpec is the parsed agent prompt extracted from the IMPL doc
type AgentSpec struct {
	Letter     string
	Prompt     string
	FilesOwned []string
}

// CompletionReport is the structured YAML block each agent appends to the IMPL doc
type CompletionReport struct {
	Status               CompletionStatus
	Worktree             string
	Branch               string
	Commit               string
	FilesChanged         []string
	FilesCreated         []string
	InterfaceDeviations  []InterfaceDeviation
	OutOfScopeDeps       []string
	TestsAdded           []string
	Verification         string
}

// InterfaceDeviation records a deviation from the spec contract
type InterfaceDeviation struct {
	Description              string
	DownstreamActionRequired bool
	Affects                  []string
}
