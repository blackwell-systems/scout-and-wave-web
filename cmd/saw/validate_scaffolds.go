package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// runValidateScaffolds validates scaffolds in the manifest and checks if all are committed.
// Command: saw validate-scaffolds <manifest-path>
// Outputs JSON array of ScaffoldStatus.
// Exits 0 if all committed, exits 1 if any not committed.
func runValidateScaffolds(args []string) error {
	fs := flag.NewFlagSet("validate-scaffolds", flag.ContinueOnError)

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("validate-scaffolds: %w", err)
	}

	if fs.NArg() < 1 {
		return fmt.Errorf("validate-scaffolds: manifest path is required\nUsage: saw validate-scaffolds <manifest-path>")
	}

	manifestPath := fs.Arg(0)

	// Load manifest
	manifest, err := protocol.Load(manifestPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("validate-scaffolds: manifest file not found: %s", manifestPath)
		}
		return fmt.Errorf("validate-scaffolds: %w", err)
	}

	// Validate scaffolds
	scaffoldStatuses := protocol.ValidateScaffolds(manifest)

	// Output JSON array
	statusJSON, err := json.MarshalIndent(scaffoldStatuses, "", "  ")
	if err != nil {
		return fmt.Errorf("validate-scaffolds: failed to marshal JSON: %w", err)
	}

	fmt.Println(string(statusJSON))

	// Check if all scaffolds committed
	allCommitted := protocol.AllScaffoldsCommitted(manifest)
	if !allCommitted {
		os.Exit(1)
	}

	return nil
}
