package main

import (
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/scaffold"
	"gopkg.in/yaml.v3"
)

// runDetectScaffolds detects shared types that need scaffold files from interface contracts.
// Command: saw detect-scaffolds <impl-path>
// Outputs YAML scaffold detection results.
func runDetectScaffolds(args []string) error {
	fs := flag.NewFlagSet("detect-scaffolds", flag.ContinueOnError)

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("detect-scaffolds: %w", err)
	}

	if fs.NArg() < 1 {
		return fmt.Errorf("detect-scaffolds: IMPL path is required\nUsage: saw detect-scaffolds <impl-path>")
	}

	implPath := fs.Arg(0)

	// Validate IMPL path exists
	if _, statErr := os.Stat(implPath); statErr != nil {
		return fmt.Errorf("detect-scaffolds: IMPL file not found: %s", implPath)
	}

	// Call SDK scaffold detector
	result, err := scaffold.DetectScaffolds(implPath)
	if err != nil {
		return fmt.Errorf("detect-scaffolds: %w", err)
	}

	// Output YAML
	data, err := yaml.Marshal(result)
	if err != nil {
		return fmt.Errorf("detect-scaffolds: failed to marshal YAML: %w", err)
	}

	fmt.Print(string(data))
	return nil
}
