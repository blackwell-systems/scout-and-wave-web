package protocol

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
	"gopkg.in/yaml.v3"
)

// ParseIMPLDoc parses a markdown IMPL doc at path and returns a structured
// IMPLDoc. It uses a line-by-line state machine — no full CommonMark parser.
//
// Partial results: if the file is readable but some sections are malformed,
// ParseIMPLDoc may return a non-nil *types.IMPLDoc together with a non-nil
// error. Callers should check both return values and use whichever partial
// data is available.
func ParseIMPLDoc(path string) (*types.IMPLDoc, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("ParseIMPLDoc: cannot open %q: %w", path, err)
	}
	defer f.Close()

	doc := &types.IMPLDoc{
		FileOwnership: make(map[string]string),
	}

	type parserState int
	const (
		stateTop         parserState = iota // scanning top-level headers
		stateFileOwner                      // inside ### File Ownership table
		stateWave                           // inside a ## Wave N section
		stateAgent                          // inside a ### Agent X: section
		stateCompletion                     // inside ### Agent X - Completion Report
	)

	state := stateTop
	var currentWave *types.Wave
	var currentAgent *types.AgentSpec
	var agentPromptLines []string

	// completionBlocks accumulates raw YAML lines for a completion report.
	// Not used in ParseIMPLDoc itself but we skip those sections cleanly.
	inYAMLBlock := false

	scanner := bufio.NewScanner(f)
	lineNum := 0

	flushAgent := func() {
		if currentAgent != nil && currentWave != nil {
			currentAgent.Prompt = strings.TrimSpace(strings.Join(agentPromptLines, "\n"))
			currentWave.Agents = append(currentWave.Agents, *currentAgent)
			currentAgent = nil
			agentPromptLines = nil
		}
	}

	flushWave := func() {
		flushAgent()
		if currentWave != nil {
			doc.Waves = append(doc.Waves, *currentWave)
			currentWave = nil
		}
	}

	for scanner.Scan() {
		line := scanner.Text()
		lineNum++

		// Track YAML fences so we don't misinterpret their content as headers.
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			inYAMLBlock = !inYAMLBlock
			if state == stateAgent {
				agentPromptLines = append(agentPromptLines, line)
			}
			continue
		}
		if inYAMLBlock {
			if state == stateAgent {
				agentPromptLines = append(agentPromptLines, line)
			}
			continue
		}

		switch {
		// ── Top-level title: # IMPL: {name}
		case strings.HasPrefix(line, "# IMPL:"):
			doc.FeatureName = strings.TrimSpace(strings.TrimPrefix(line, "# IMPL:"))
			state = stateTop

		// ── Metadata: **Test Command:** go test ./...  (or without bold)
		case state == stateTop && (strings.HasPrefix(trimmed, "**Test Command:**") ||
			strings.HasPrefix(trimmed, "Test Command:")):
			val := trimmed
			if idx := strings.Index(val, ":"); idx >= 0 {
				val = strings.TrimSpace(val[idx+1:])
			}
			val = strings.Trim(val, "`")
			doc.TestCommand = val

		// ── Wave section: ## Wave N
		case strings.HasPrefix(line, "## Wave "):
			flushWave()
			rest := strings.TrimPrefix(line, "## Wave ")
			rest = strings.Fields(rest)[0] // take first token (the number)
			var n int
			if _, err2 := fmt.Sscanf(rest, "%d", &n); err2 != nil {
				// best-effort: skip malformed wave header
				state = stateTop
				continue
			}
			currentWave = &types.Wave{Number: n}
			state = stateWave

		// ── Other ## headers (non-Wave): leave wave context
		case strings.HasPrefix(line, "## ") && !strings.HasPrefix(line, "## Wave "):
			flushWave()
			state = stateTop

		// ── Agent completion report: ### Agent X - Completion Report
		case isCompletionReportHeader(line):
			flushAgent()
			state = stateCompletion

		// ── File ownership table header: ### File Ownership
		case trimmed == "### File Ownership":
			flushAgent()
			state = stateFileOwner

		// ── Agent subsection: ### Agent X: Description  (within a wave, or
		//    switching to a new agent while already inside one).
		//    Completion-report headers are handled above and are excluded here.
		case (state == stateWave || state == stateAgent) && isAgentHeader(line) && !isCompletionReportHeader(line):
			flushAgent()
			letter := extractAgentLetter(line)
			currentAgent = &types.AgentSpec{Letter: letter}
			agentPromptLines = nil
			state = stateAgent

		// ── Any other ### header inside an agent prompt — accumulate as prompt text
		case strings.HasPrefix(line, "### ") && state == stateAgent:
			agentPromptLines = append(agentPromptLines, line)

		// ── File ownership table rows
		case state == stateFileOwner && strings.HasPrefix(line, "|"):
			parseFileOwnershipRow(line, doc.FileOwnership)

		// ── Accumulate agent prompt text
		case state == stateAgent:
			agentPromptLines = append(agentPromptLines, line)
		}
	}

	flushWave()

	if err2 := scanner.Err(); err2 != nil {
		return doc, fmt.Errorf("ParseIMPLDoc: scanner error reading %q: %w", path, err2)
	}

	if doc.FeatureName == "" {
		return doc, fmt.Errorf("ParseIMPLDoc: %q: missing '# IMPL:' title", path)
	}

	// Populate FilesOwned for each agent from the authoritative FileOwnership table.
	for i := range doc.Waves {
		for j := range doc.Waves[i].Agents {
			agent := &doc.Waves[i].Agents[j]
			agent.FilesOwned = nil
			for file, letter := range doc.FileOwnership {
				if letter == agent.Letter {
					agent.FilesOwned = append(agent.FilesOwned, file)
				}
			}
		}
	}

	return doc, nil
}

// ValidateInvariants checks Invariant I1: no file appears in two different
// agents' ownership lists within the same wave. Returns a descriptive error
// for the first violation found, or nil if the document is clean.
func ValidateInvariants(doc *types.IMPLDoc) error {
	if doc == nil {
		return nil
	}
	for _, wave := range doc.Waves {
		seen := make(map[string]string) // file -> agent letter
		for _, agent := range wave.Agents {
			for _, file := range agent.FilesOwned {
				if prev, ok := seen[file]; ok {
					return fmt.Errorf(
						"I1 violation in Wave %d: file %q claimed by both Agent %s and Agent %s",
						wave.Number, file, prev, agent.Letter,
					)
				}
				seen[file] = agent.Letter
			}
		}
	}
	return nil
}

// ParseCompletionReport extracts the named agent's completion report from the
// IMPL doc at path. agentLetter is a single uppercase letter ("A", "B", etc.).
// Returns ErrReportNotFound if the section does not exist in the file.
func ParseCompletionReport(path string, agentLetter string) (*types.CompletionReport, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("ParseCompletionReport: cannot open %q: %w", path, err)
	}
	defer f.Close()

	headerTarget := fmt.Sprintf("### Agent %s - Completion Report", agentLetter)

	type scanState int
	const (
		scanLooking  scanState = iota // searching for the section header
		scanInSection                 // found header, looking for yaml fence
		scanInYAML                    // inside ```yaml ... ```
	)

	state := scanLooking
	var yamlLines []string
	inYAML := false
	_ = inYAML

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)

		switch state {
		case scanLooking:
			if strings.TrimSpace(line) == headerTarget {
				state = scanInSection
			}

		case scanInSection:
			if strings.HasPrefix(trimmed, "```yaml") {
				state = scanInYAML
			} else if strings.HasPrefix(trimmed, "```") {
				// plain fence — treat as yaml start anyway (spec says ```yaml)
				state = scanInYAML
			} else if strings.HasPrefix(trimmed, "### ") || strings.HasPrefix(trimmed, "## ") {
				// Next section header — no yaml block found
				break
			}

		case scanInYAML:
			if strings.HasPrefix(trimmed, "```") {
				// Closing fence — we have all the YAML
				goto done
			}
			yamlLines = append(yamlLines, line)
		}
	}

done:
	if err2 := scanner.Err(); err2 != nil {
		return nil, fmt.Errorf("ParseCompletionReport: scanner error reading %q: %w", path, err2)
	}

	if state == scanLooking {
		return nil, ErrReportNotFound
	}
	if len(yamlLines) == 0 {
		return nil, fmt.Errorf("ParseCompletionReport: agent %s section found in %q but YAML block is empty", agentLetter, path)
	}

	// Unmarshal the YAML into a raw map first so we can handle snake_case keys.
	raw := struct {
		Status              string   `yaml:"status"`
		Worktree            string   `yaml:"worktree"`
		Branch              string   `yaml:"branch"`
		Commit              string   `yaml:"commit"`
		FilesChanged        []string `yaml:"files_changed"`
		FilesCreated        []string `yaml:"files_created"`
		InterfaceDeviations []struct {
			Description              string   `yaml:"description"`
			DownstreamActionRequired bool     `yaml:"downstream_action_required"`
			Affects                  []string `yaml:"affects"`
		} `yaml:"interface_deviations"`
		OutOfScopeDeps []string `yaml:"out_of_scope_deps"`
		TestsAdded     []string `yaml:"tests_added"`
		Verification   string   `yaml:"verification"`
	}{}

	yamlStr := strings.Join(yamlLines, "\n")
	if err3 := yaml.Unmarshal([]byte(yamlStr), &raw); err3 != nil {
		return nil, fmt.Errorf("ParseCompletionReport: agent %s YAML in %q: %w", agentLetter, path, err3)
	}

	report := &types.CompletionReport{
		Status:         types.CompletionStatus(raw.Status),
		Worktree:       raw.Worktree,
		Branch:         raw.Branch,
		Commit:         raw.Commit,
		FilesChanged:   raw.FilesChanged,
		FilesCreated:   raw.FilesCreated,
		OutOfScopeDeps: raw.OutOfScopeDeps,
		TestsAdded:     raw.TestsAdded,
		Verification:   raw.Verification,
	}
	for _, d := range raw.InterfaceDeviations {
		report.InterfaceDeviations = append(report.InterfaceDeviations, types.InterfaceDeviation{
			Description:              d.Description,
			DownstreamActionRequired: d.DownstreamActionRequired,
			Affects:                  d.Affects,
		})
	}

	return report, nil
}

// ── helpers ──────────────────────────────────────────────────────────────────

// isAgentHeader returns true for lines like "### Agent A: Description".
func isAgentHeader(line string) bool {
	if !strings.HasPrefix(line, "### Agent ") {
		return false
	}
	rest := strings.TrimPrefix(line, "### Agent ")
	if len(rest) == 0 {
		return false
	}
	// Must be a single uppercase letter followed by ':' or end-of-string.
	letter := string(rest[0])
	if letter < "A" || letter > "Z" {
		return false
	}
	if len(rest) == 1 {
		return true
	}
	return rest[1] == ':' || rest[1] == ' '
}

// isCompletionReportHeader returns true for lines like
// "### Agent A - Completion Report".
func isCompletionReportHeader(line string) bool {
	if !strings.HasPrefix(line, "### Agent ") {
		return false
	}
	return strings.Contains(line, "- Completion Report")
}

// extractAgentLetter returns the single uppercase letter from a header like
// "### Agent A: ..." or "### Agent A - Completion Report".
func extractAgentLetter(line string) string {
	rest := strings.TrimPrefix(line, "### Agent ")
	if len(rest) == 0 {
		return ""
	}
	return string(rest[0])
}

// parseFileOwnershipRow parses a markdown table row like:
//
//	| pkg/protocol/parser.go | A | 1 | — |
//
// and populates the ownership map (file -> agentLetter).
func parseFileOwnershipRow(line string, ownership map[string]string) {
	// Split on "|" and trim whitespace from each cell.
	parts := strings.Split(line, "|")
	// A valid data row has at least 4 cells (leading empty + 3+ columns).
	if len(parts) < 4 {
		return
	}
	file := strings.TrimSpace(parts[1])
	agent := strings.TrimSpace(parts[2])

	// Skip header rows or separator rows.
	if file == "" || file == "file" || file == "File" ||
		strings.Contains(file, "---") || strings.Contains(agent, "---") {
		return
	}
	if agent == "" || agent == "agent-letter" || agent == "Agent" {
		return
	}

	// Normalise backtick-wrapped paths: `pkg/protocol/parser.go` -> pkg/protocol/parser.go
	file = strings.Trim(file, "`")
	agent = strings.Trim(agent, "`")

	ownership[file] = agent
}

