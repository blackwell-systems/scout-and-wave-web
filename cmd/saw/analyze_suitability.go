package main

import (
	"errors"
	"flag"
	"fmt"
	"os"

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

	// Call SDK suitability analyzer
	result, err := suitability.AnalyzeSuitability(requirementsFile, repoRoot)
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
