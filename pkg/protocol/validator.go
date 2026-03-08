package protocol

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

// typedBlockRe matches the opening fence of a typed block, e.g.:
//
//	```yaml type=impl-file-ownership
var typedBlockRe = regexp.MustCompile("^```yaml\\s+type=(impl-[a-z-]+)")

// agentLineRe matches agent lines like "    [A] some/file" (leading whitespace + [LETTER]).
var agentLineRe = regexp.MustCompile(`^\s+\[([A-Z])\]`)

// waveHeaderRe matches "Wave N" at the start of a line.
var waveHeaderRe = regexp.MustCompile(`^Wave [0-9]+`)

// agentRefRe matches any [A-Z] reference.
var agentRefRe = regexp.MustCompile(`\[[A-Z]\]`)

// waveStructureRe matches "Wave N:" at the start of a line.
var waveStructureRe = regexp.MustCompile(`^Wave [0-9]+:`)

// rootOrDependsRe matches either "✓ root" or "depends on:" within agent block lines.
var rootOrDependsRe = regexp.MustCompile(`✓ root|depends on:`)

// ValidateIMPLDoc runs E16 typed-block validation on the IMPL doc at path.
// It reads the file directly (not via ParseIMPLDoc) to preserve line numbers.
// Returns nil slice if all blocks are valid or no typed blocks exist.
// Returns one types.ValidationError per violation; multiple errors may be returned.
func ValidateIMPLDoc(path string) ([]types.ValidationError, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("ValidateIMPLDoc: cannot open %q: %w", path, err)
	}
	defer f.Close()

	// First pass: scan all lines into memory so we can extract block contents
	// with correct line numbers.
	var lines []string
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	if err2 := scanner.Err(); err2 != nil {
		return nil, fmt.Errorf("ValidateIMPLDoc: scanner error reading %q: %w", path, err2)
	}

	var errs []types.ValidationError

	for i, line := range lines {
		m := typedBlockRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		blockType := m[1]
		lineNumber := i + 1 // 1-based

		// Extract block content: lines after the opening fence until closing ```.
		var blockLines []string
		for j := i + 1; j < len(lines); j++ {
			if strings.TrimRight(lines[j], " \t") == "```" {
				break
			}
			blockLines = append(blockLines, lines[j])
		}

		var blockErrs []types.ValidationError
		switch blockType {
		case "impl-file-ownership":
			blockErrs = validateFileOwnership(blockLines, lineNumber)
		case "impl-dep-graph":
			blockErrs = validateDepGraph(blockLines, lineNumber)
		case "impl-wave-structure":
			blockErrs = validateWaveStructure(blockLines, lineNumber)
		case "impl-completion-report":
			blockErrs = validateCompletionReport(blockLines, lineNumber)
		}
		errs = append(errs, blockErrs...)
	}

	if len(errs) == 0 {
		return nil, nil
	}
	return errs, nil
}

// validateFileOwnership validates an impl-file-ownership block.
func validateFileOwnership(lines []string, lineNumber int) []types.ValidationError {
	var errs []types.ValidationError
	content := strings.Join(lines, "\n")

	// Must have a header row containing "| File "
	if !strings.Contains(content, "| File ") {
		errs = append(errs, types.ValidationError{
			BlockType:  "impl-file-ownership",
			LineNumber: lineNumber,
			Message:    fmt.Sprintf("impl-file-ownership block (line %d): missing header row — expected '| File | Agent | Wave | Depends On |'", lineNumber),
		})
		return errs
	}

	// Must have at least one data row (not header, not separator |---|)
	dataRows := 0
	for _, row := range lines {
		if !strings.HasPrefix(row, "|") {
			continue
		}
		if strings.Contains(row, "File") {
			continue
		}
		if strings.Contains(row, "---") {
			continue
		}
		if strings.TrimSpace(row) == "" {
			continue
		}
		dataRows++
	}
	if dataRows == 0 {
		errs = append(errs, types.ValidationError{
			BlockType:  "impl-file-ownership",
			LineNumber: lineNumber,
			Message:    fmt.Sprintf("impl-file-ownership block (line %d): no data rows found — table must have at least one file entry", lineNumber),
		})
	}

	// Each data row must have at least 4 pipe characters
	for _, row := range lines {
		if strings.Contains(row, "File") {
			continue
		}
		if strings.Contains(row, "----") {
			continue
		}
		if strings.TrimSpace(row) == "" {
			continue
		}
		pipeCount := strings.Count(row, "|")
		if pipeCount < 4 {
			errs = append(errs, types.ValidationError{
				BlockType:  "impl-file-ownership",
				LineNumber: lineNumber,
				Message:    fmt.Sprintf("impl-file-ownership block (line %d): row has fewer than 4 columns: %s", lineNumber, row),
			})
		}
	}

	return errs
}

// validateDepGraph validates an impl-dep-graph block.
func validateDepGraph(lines []string, lineNumber int) []types.ValidationError {
	var errs []types.ValidationError
	content := strings.Join(lines, "\n")

	// Must have at least one line matching "^Wave [0-9]+"
	if !waveHeaderRe.MatchString(content) {
		errs = append(errs, types.ValidationError{
			BlockType:  "impl-dep-graph",
			LineNumber: lineNumber,
			Message:    fmt.Sprintf("impl-dep-graph block (line %d): missing 'Wave N (...):' header — each wave must start with 'Wave N'", lineNumber),
		})
		return errs
	}

	// Must have at least one line matching "[A-Z]"
	if !agentRefRe.MatchString(content) {
		errs = append(errs, types.ValidationError{
			BlockType:  "impl-dep-graph",
			LineNumber: lineNumber,
			Message:    fmt.Sprintf("impl-dep-graph block (line %d): no agent lines found — expected lines like '    [A] path/to/file'", lineNumber),
		})
		return errs
	}

	// Each agent block must contain either "✓ root" or "depends on:"
	// Collect agent lines; for each agent accumulate its block until the next agent line.
	type agentBlock struct {
		letter string
		lines  []string
	}
	var blocks []agentBlock
	var current *agentBlock

	for _, ln := range lines {
		if m := agentLineRe.FindStringSubmatch(ln); m != nil {
			// Flush previous agent
			if current != nil {
				blocks = append(blocks, *current)
			}
			current = &agentBlock{letter: m[1], lines: []string{ln}}
		} else if current != nil {
			current.lines = append(current.lines, ln)
		}
	}
	if current != nil {
		blocks = append(blocks, *current)
	}

	for _, block := range blocks {
		blockContent := strings.Join(block.lines, "\n")
		if !rootOrDependsRe.MatchString(blockContent) {
			errs = append(errs, types.ValidationError{
				BlockType:  "impl-dep-graph",
				LineNumber: lineNumber,
				Message:    fmt.Sprintf("impl-dep-graph block (line %d): agent [%s] has neither '✓ root' nor 'depends on:' — one is required", lineNumber, block.letter),
			})
		}
	}

	return errs
}

// validateWaveStructure validates an impl-wave-structure block.
func validateWaveStructure(lines []string, lineNumber int) []types.ValidationError {
	var errs []types.ValidationError
	content := strings.Join(lines, "\n")

	// Must have at least one line matching "^Wave [0-9]+:"
	if !waveStructureRe.MatchString(content) {
		errs = append(errs, types.ValidationError{
			BlockType:  "impl-wave-structure",
			LineNumber: lineNumber,
			Message:    fmt.Sprintf("impl-wave-structure block (line %d): missing 'Wave N:' lines — each wave must appear as 'Wave N: [A] [B]'", lineNumber),
		})
		return errs
	}

	// Must reference at least one agent letter [A-Z]
	if !agentRefRe.MatchString(content) {
		errs = append(errs, types.ValidationError{
			BlockType:  "impl-wave-structure",
			LineNumber: lineNumber,
			Message:    fmt.Sprintf("impl-wave-structure block (line %d): no agent letters found — expected [A], [B], etc.", lineNumber),
		})
	}

	return errs
}

// completionReportRequiredFields lists the required field prefixes for impl-completion-report.
var completionReportRequiredFields = []string{
	"status:",
	"worktree:",
	"branch:",
	"commit:",
	"files_changed:",
	"interface_deviations:",
	"verification:",
}

// validateCompletionReport validates an impl-completion-report block.
func validateCompletionReport(lines []string, lineNumber int) []types.ValidationError {
	var errs []types.ValidationError

	// Check required fields
	for _, field := range completionReportRequiredFields {
		found := false
		for _, ln := range lines {
			if strings.HasPrefix(ln, field) {
				found = true
				break
			}
		}
		if !found {
			errs = append(errs, types.ValidationError{
				BlockType:  "impl-completion-report",
				LineNumber: lineNumber,
				Message:    fmt.Sprintf("impl-completion-report block (line %d): missing required field '%s'", lineNumber, field),
			})
		}
	}

	// Validate status value
	for _, ln := range lines {
		if !strings.HasPrefix(ln, "status:") {
			continue
		}
		// Extract the raw value after "status:" for template-placeholder detection.
		rawVal := strings.TrimSpace(strings.TrimPrefix(ln, "status:"))

		// Detect the template placeholder "complete | partial | blocked" (contains "|").
		// The bash script's tr -d '[:space:]' + cut -d'|' -f1 would silently pass this,
		// but we explicitly reject multi-value placeholders.
		if strings.Contains(rawVal, "|") {
			errs = append(errs, types.ValidationError{
				BlockType:  "impl-completion-report",
				LineNumber: lineNumber,
				Message:    fmt.Sprintf("impl-completion-report block (line %d): status must be 'complete', 'partial', or 'blocked' — got: '%s'", lineNumber, rawVal),
			})
			break
		}

		val := rawVal
		if val != "complete" && val != "partial" && val != "blocked" {
			errs = append(errs, types.ValidationError{
				BlockType:  "impl-completion-report",
				LineNumber: lineNumber,
				Message:    fmt.Sprintf("impl-completion-report block (line %d): status must be 'complete', 'partial', or 'blocked' — got: '%s'", lineNumber, val),
			})
		}
		break
	}

	return errs
}
