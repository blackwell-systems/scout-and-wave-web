package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/suitability"
	"gopkg.in/yaml.v3"
)

// runAnalyzeSuitability scans codebase for pre-implementation status of requirements.
// Command: saw analyze-suitability <requirements-file> <repo-root>
// Outputs YAML suitability analysis with scaffolding recommendations.
func runAnalyzeSuitability(args []string) error {
	fs := flag.NewFlagSet("analyze-suitability", flag.ContinueOnError)

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("analyze-suitability: %w", err)
	}

	if fs.NArg() < 2 {
		return fmt.Errorf("analyze-suitability: requirements file and repo root are required\nUsage: saw analyze-suitability <requirements-file> <repo-root>")
	}

	requirementsFile := fs.Arg(0)
	repoRoot := fs.Arg(1)

	// Validate inputs exist
	if _, statErr := os.Stat(requirementsFile); statErr != nil {
		return fmt.Errorf("analyze-suitability: requirements file not found: %s", requirementsFile)
	}
	if _, statErr := os.Stat(repoRoot); statErr != nil {
		return fmt.Errorf("analyze-suitability: repo root not found: %s", repoRoot)
	}

	// Read requirements document
	reqData, err := os.ReadFile(requirementsFile)
	if err != nil {
		return fmt.Errorf("analyze-suitability: read requirements doc: %w", err)
	}

	// Parse requirements
	requirements, err := parseRequirements(string(reqData))
	if err != nil {
		return fmt.Errorf("analyze-suitability: parse requirements: %w", err)
	}

	if len(requirements) == 0 {
		return fmt.Errorf("analyze-suitability: no valid requirements found in %s", requirementsFile)
	}

	// Call SDK suitability analyzer
	result, err := suitability.ScanPreImplementation(repoRoot, requirements)
	if err != nil {
		return fmt.Errorf("analyze-suitability: %w", err)
	}

	// Output YAML
	data, err := yaml.Marshal(result)
	if err != nil {
		return fmt.Errorf("analyze-suitability: failed to marshal YAML: %w", err)
	}

	fmt.Print(string(data))
	return nil
}

// parseRequirements extracts structured requirements from markdown or plain text.
// Expected format:
//
//	## F1: Add authentication handler
//	Location: pkg/auth/handler.go
//
//	## SEC-01: Add session timeout
//	Location: pkg/session/timeout.go
//
// Returns a slice of Requirement structs with ID, Description, and Files populated.
func parseRequirements(content string) ([]suitability.Requirement, error) {
	var requirements []suitability.Requirement

	// Pattern 1: Markdown headers with "Location:" field
	// ## F1: Description
	// Location: path/to/file.go
	headerPattern := regexp.MustCompile(`(?m)^##\s+([A-Za-z0-9_-]+):\s*(.+)$`)
	locationPattern := regexp.MustCompile(`(?m)^Location:\s*(.+)$`)

	lines := strings.Split(content, "\n")

	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])

		// Match requirement header
		if matches := headerPattern.FindStringSubmatch(line); matches != nil {
			id := strings.TrimSpace(matches[1])
			description := strings.TrimSpace(matches[2])

			// Look ahead for Location field (within next 10 lines)
			var files []string
			for j := i + 1; j < len(lines) && j < i+10; j++ {
				locationLine := strings.TrimSpace(lines[j])

				// Stop if we hit another header
				if strings.HasPrefix(locationLine, "##") {
					break
				}

				// Extract location
				if locMatches := locationPattern.FindStringSubmatch(locationLine); locMatches != nil {
					filePath := strings.TrimSpace(locMatches[1])
					if filePath != "" {
						files = append(files, filePath)
					}
				}
			}

			// Only add requirement if it has at least one file location
			if len(files) > 0 {
				requirements = append(requirements, suitability.Requirement{
					ID:          id,
					Description: description,
					Files:       files,
				})
			}
		}
	}

	// Pattern 2: Plain text format (fallback)
	// F1: Description | path/to/file.go
	if len(requirements) == 0 {
		plainPattern := regexp.MustCompile(`^([A-Za-z0-9_-]+):\s*([^|]+)\|\s*(.+)$`)
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if matches := plainPattern.FindStringSubmatch(line); matches != nil {
				id := strings.TrimSpace(matches[1])
				description := strings.TrimSpace(matches[2])
				filePath := strings.TrimSpace(matches[3])

				if id != "" && filePath != "" {
					requirements = append(requirements, suitability.Requirement{
						ID:          id,
						Description: description,
						Files:       []string{filePath},
					})
				}
			}
		}
	}

	return requirements, nil
}
