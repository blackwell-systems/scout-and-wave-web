package types

// State represents the state of the protocol state machine
type State int

const (
	SuitabilityPending State = iota
	NotSuitable
	Reviewed
	WavePending
	WaveExecuting
	WaveVerified
	Complete
)

// String returns the string representation of the State
func (s State) String() string {
	switch s {
	case SuitabilityPending:
		return "SuitabilityPending"
	case NotSuitable:
		return "NotSuitable"
	case Reviewed:
		return "Reviewed"
	case WavePending:
		return "WavePending"
	case WaveExecuting:
		return "WaveExecuting"
	case WaveVerified:
		return "WaveVerified"
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
	LintCommand   string            // post-merge lint command (e.g. "go vet ./..."); temp scaffold, canonical change owned by Agent A
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
