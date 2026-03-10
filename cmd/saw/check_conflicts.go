package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// runCheckConflicts detects file ownership conflicts across agents.
// Command: saw check-conflicts <manifest-path>
// Outputs JSON array of OwnershipConflict (empty array if none). Exits 1 if conflicts found.
func runCheckConflicts(args []string) error {
	fs := flag.NewFlagSet("check-conflicts", flag.ContinueOnError)

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("check-conflicts: %w", err)
	}

	if fs.NArg() < 1 {
		return fmt.Errorf("check-conflicts: manifest path is required\nUsage: saw check-conflicts <manifest-path>")
	}

	manifestPath := fs.Arg(0)

	// Load the manifest
	manifest, err := protocol.Load(manifestPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("check-conflicts: manifest file not found: %s", manifestPath)
		}
		return fmt.Errorf("check-conflicts: %w", err)
	}

	// Detect conflicts
	conflicts := protocol.DetectOwnershipConflicts(manifest, manifest.CompletionReports)

	// Output JSON array
	conflictsJSON, err := json.MarshalIndent(conflicts, "", "  ")
	if err != nil {
		return fmt.Errorf("check-conflicts: failed to marshal conflicts: %w", err)
	}

	fmt.Println(string(conflictsJSON))

	// Exit 1 if conflicts found
	if len(conflicts) > 0 {
		os.Exit(1)
	}

	return nil
}
