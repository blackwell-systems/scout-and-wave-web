package main

import (
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/commands"
	"gopkg.in/yaml.v3"
)

// runExtractCommands extracts build/test/lint/format commands from CI configs and manifests.
// Command: saw extract-commands <repo-root>
// Outputs YAML commands extraction results.
func runExtractCommands(args []string) error {
	fs := flag.NewFlagSet("extract-commands", flag.ContinueOnError)

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("extract-commands: %w", err)
	}

	if fs.NArg() < 1 {
		return fmt.Errorf("extract-commands: repo root is required\nUsage: saw extract-commands <repo-root>")
	}

	repoRoot := fs.Arg(0)

	// Validate repo root exists
	if _, statErr := os.Stat(repoRoot); statErr != nil {
		return fmt.Errorf("extract-commands: repo root not found: %s", repoRoot)
	}

	// Call SDK commands extractor
	result, err := commands.ExtractCommands(repoRoot)
	if err != nil {
		return fmt.Errorf("extract-commands: %w", err)
	}

	// Output YAML
	data, err := yaml.Marshal(result)
	if err != nil {
		return fmt.Errorf("extract-commands: failed to marshal YAML: %w", err)
	}

	fmt.Print(string(data))
	return nil
}
