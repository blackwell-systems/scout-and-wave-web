package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// runFreezeCheck checks for freeze violations in the manifest.
// Command: saw freeze-check <manifest-path>
// Outputs JSON array of FreezeViolation (empty if no violations).
// Exits 0 if no violations, exits 1 if violations found.
func runFreezeCheck(args []string) error {
	fs := flag.NewFlagSet("freeze-check", flag.ContinueOnError)

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("freeze-check: %w", err)
	}

	if fs.NArg() < 1 {
		return fmt.Errorf("freeze-check: manifest path is required\nUsage: saw freeze-check <manifest-path>")
	}

	manifestPath := fs.Arg(0)

	// Load manifest
	manifest, err := protocol.Load(manifestPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("freeze-check: manifest file not found: %s", manifestPath)
		}
		return fmt.Errorf("freeze-check: %w", err)
	}

	// Check for freeze violations
	violations, err := protocol.CheckFreeze(manifest)
	if err != nil {
		return fmt.Errorf("freeze-check: %w", err)
	}

	// Output JSON array
	violationsJSON, err := json.MarshalIndent(violations, "", "  ")
	if err != nil {
		return fmt.Errorf("freeze-check: failed to marshal JSON: %w", err)
	}

	fmt.Println(string(violationsJSON))

	// Exit 1 if violations found
	if len(violations) > 0 {
		os.Exit(1)
	}

	return nil
}
