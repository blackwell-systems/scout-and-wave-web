package api

// IMPLDocResponse is the JSON body for GET /api/impl/{slug}.
type IMPLDocResponse struct {
	Slug                   string               `json:"slug"`
	DocStatus              string               `json:"doc_status"`              // "ACTIVE" or "COMPLETE"
	CompletedAt            string               `json:"completed_at,omitempty"`  // ISO date, present only when COMPLETE
	Suitability            SuitabilityInfo      `json:"suitability"`
	FileOwnership          []FileOwnershipEntry `json:"file_ownership"`
	FileOwnershipCol4Name  string               `json:"file_ownership_col4_name"` // detected 4th column header (e.g. "Action", "Depends On")
	Waves                  []WaveInfo           `json:"waves"`
	Scaffold               ScaffoldInfo         `json:"scaffold"`
	KnownIssues            []KnownIssueEntry    `json:"known_issues"`
	ScaffoldsDetail        []ScaffoldFileEntry  `json:"scaffolds_detail"`
	InterfaceContractsText string               `json:"interface_contracts_text"`
	DependencyGraphText    string               `json:"dependency_graph_text"`
	PostMergeChecklistText string               `json:"post_merge_checklist_text"`
	AgentPrompts           []AgentPromptEntry   `json:"agent_prompts"`
}

// SuitabilityInfo is the suitability sub-object in IMPLDocResponse.
type SuitabilityInfo struct {
	Verdict   string `json:"verdict"`
	Rationale string `json:"rationale"`
}

// FileOwnershipEntry is one row of the file ownership table.
type FileOwnershipEntry struct {
	File      string `json:"file"`
	Agent     string `json:"agent"`
	Wave      int    `json:"wave"`
	Action    string `json:"action"`     // "new", "modify", "delete", or ""
	DependsOn string `json:"depends_on"` // populated when 4th column is "Depends On"
}

// WaveInfo describes one wave in the IMPL doc.
type WaveInfo struct {
	Number       int      `json:"number"`
	Agents       []string `json:"agents"`
	Dependencies []int    `json:"dependencies"`
}

// ScaffoldInfo describes the scaffold section of the IMPL doc.
type ScaffoldInfo struct {
	Required  bool            `json:"required"`
	Files     []string        `json:"files"`
	Contracts []ContractEntry `json:"contracts"`
}

// ContractEntry is one interface contract in the scaffold.
type ContractEntry struct {
	Name      string `json:"name"`
	Signature string `json:"signature"`
	File      string `json:"file"`
}

// KnownIssueEntry is one known issue from the IMPL doc.
type KnownIssueEntry struct {
	Description string `json:"description"`
	Status      string `json:"status"`
	Workaround  string `json:"workaround"`
}

// ScaffoldFileEntry is one scaffold file with its contents.
type ScaffoldFileEntry struct {
	FilePath   string `json:"file_path"`
	Contents   string `json:"contents"`
	ImportPath string `json:"import_path"`
}

// AgentPromptEntry is one agent prompt extracted from a wave.
type AgentPromptEntry struct {
	Wave   int    `json:"wave"`
	Agent  string `json:"agent"`
	Prompt string `json:"prompt"`
}

// SSEEvent is the canonical shape written to the SSE stream.
// Data is marshaled to JSON and written as the `data:` field.
type SSEEvent struct {
	Event string      `json:"event"` // scaffold_started, agent_started, agent_complete, agent_failed, gate_result, wave_complete, run_complete
	Data  interface{} `json:"data"`
}
