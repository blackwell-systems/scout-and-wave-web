package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// runRunGates executes verification gates for a specific wave.
// Command: saw run-gates <manifest-path> --wave <N> [--repo-dir <path>]
// Outputs JSON array of GateResult. Exits 1 if any required gate failed.
func runRunGates(args []string) error {
	fs := flag.NewFlagSet("run-gates", flag.ContinueOnError)
	waveFlag := fs.Int("wave", 0, "Wave number (required)")
	repoDirFlag := fs.String("repo-dir", ".", "Repository directory")

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("run-gates: %w", err)
	}

	if fs.NArg() < 1 {
		return fmt.Errorf("run-gates: manifest path is required\nUsage: saw run-gates <manifest-path> --wave <N> [--repo-dir <path>]")
	}

	if *waveFlag == 0 {
		return fmt.Errorf("run-gates: --wave flag is required")
	}

	manifestPath := fs.Arg(0)

	// Load the manifest
	manifest, err := protocol.Load(manifestPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("run-gates: manifest file not found: %s", manifestPath)
		}
		return fmt.Errorf("run-gates: %w", err)
	}

	// Run gates
	gateResults := protocol.RunGates(manifest, *waveFlag, *repoDirFlag)
	if gateResults.IsFatal() {
		return fmt.Errorf("run-gates fatal error")
	}

	// Output JSON array
	resultJSON, err := json.MarshalIndent(gateResults.Data.Gates, "", "  ")
	if err != nil {
		return fmt.Errorf("run-gates: failed to marshal results: %w", err)
	}

	fmt.Println(string(resultJSON))

	// Check if any required gates failed
	hasFailures := false
	for _, result := range gateResults.Data.Gates {
		if !result.Passed && result.Required {
			hasFailures = true
			break
		}
	}

	if hasFailures {
		os.Exit(1)
	}

	return nil
}
