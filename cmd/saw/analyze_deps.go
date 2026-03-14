package main

import (
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/analyzer"
	"gopkg.in/yaml.v3"
)

// runAnalyzeDeps analyzes Go repository dependencies and produces dependency graph.
// Command: saw analyze-deps [--target file1.go,file2.go] <repo-root>
// Outputs YAML dependency graph with wave candidates.
func runAnalyzeDeps(args []string) error {
	fs := flag.NewFlagSet("analyze-deps", flag.ContinueOnError)
	targetFiles := fs.String("target", "", "Comma-separated list of target files to analyze (optional)")

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("analyze-deps: %w", err)
	}

	if fs.NArg() < 1 {
		return fmt.Errorf("analyze-deps: repo root is required\nUsage: saw analyze-deps [--target files] <repo-root>")
	}

	repoRoot := fs.Arg(0)

	// Validate repo root exists
	if _, statErr := os.Stat(repoRoot); statErr != nil {
		return fmt.Errorf("analyze-deps: repo root not found: %s", repoRoot)
	}

	// Parse target files if provided
	var targets []string
	if *targetFiles != "" {
		// Simple comma split (analyzer package handles validation)
		for i, tf := range splitComma(*targetFiles) {
			if tf != "" {
				targets = append(targets, tf)
			}
			_ = i
		}
	}

	// Call SDK analyzer
	result, err := analyzer.AnalyzeDeps(repoRoot, targets)
	if err != nil {
		return fmt.Errorf("analyze-deps: %w", err)
	}

	// Output YAML
	data, err := yaml.Marshal(result)
	if err != nil {
		return fmt.Errorf("analyze-deps: failed to marshal YAML: %w", err)
	}

	fmt.Print(string(data))
	return nil
}

// splitComma is a simple comma splitter helper
func splitComma(s string) []string {
	if s == "" {
		return nil
	}
	result := []string{}
	current := ""
	for _, c := range s {
		if c == ',' {
			result = append(result, current)
			current = ""
		} else {
			current += string(c)
		}
	}
	if current != "" {
		result = append(result, current)
	}
	return result
}
