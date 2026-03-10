package main

import (
	"fmt"
	"os"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// runCurrentWave parses the manifest-path argument and returns the wave number
// of the first incomplete wave, or "complete" if all waves are complete.
// Usage: saw current-wave <manifest-path>
func runCurrentWave(args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("current-wave: manifest path is required\nUsage: saw current-wave <manifest-path>")
	}

	manifestPath := args[0]

	// Validate the manifest path exists
	if _, err := os.Stat(manifestPath); err != nil {
		return fmt.Errorf("current-wave: manifest not found: %s", manifestPath)
	}

	// Load the manifest
	manifest, err := protocol.Load(manifestPath)
	if err != nil {
		return fmt.Errorf("current-wave: %w", err)
	}

	// Get the current wave
	currentWave := protocol.CurrentWave(manifest)

	// Output the result
	if currentWave == nil {
		fmt.Println("complete")
	} else {
		fmt.Println(currentWave.Number)
	}

	return nil
}
