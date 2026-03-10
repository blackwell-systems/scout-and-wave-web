package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// runValidate parses flags and validates a YAML IMPL manifest using the SDK.
// Command: saw validate <manifest-path>
// Exits 0 with success message if valid, exits 1 with JSON error array if invalid.
func runValidate(args []string) error {
	fs := flag.NewFlagSet("validate", flag.ContinueOnError)

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("validate: %w", err)
	}

	if fs.NArg() < 1 {
		return fmt.Errorf("validate: manifest path is required\nUsage: saw validate <manifest-path>")
	}

	manifestPath := fs.Arg(0)

	// Load the manifest
	manifest, err := protocol.Load(manifestPath)
	if err != nil {
		// Check if it's a file not found error
		if os.IsNotExist(err) {
			return fmt.Errorf("validate: manifest file not found: %s", manifestPath)
		}
		// Other errors (YAML parse errors, read errors)
		return fmt.Errorf("validate: %w", err)
	}

	// Run validation
	validationErrors := protocol.Validate(manifest)

	if len(validationErrors) == 0 {
		// Valid manifest
		fmt.Println("✓ Manifest valid")
		return nil
	}

	// Invalid manifest: output JSON array to stderr and exit 1
	errJSON, err := json.MarshalIndent(validationErrors, "", "  ")
	if err != nil {
		// Fallback if JSON marshaling fails
		return fmt.Errorf("validate: manifest has validation errors but failed to marshal JSON: %w", err)
	}

	fmt.Fprintln(os.Stderr, string(errJSON))
	os.Exit(1)
	return nil // unreachable, but satisfies the function signature
}
