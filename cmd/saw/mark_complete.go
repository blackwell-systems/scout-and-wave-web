package main

import (
	"errors"
	"flag"
	"fmt"
	"time"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// runMarkComplete writes a SAW:COMPLETE marker to an IMPL doc.
// Command: saw mark-complete <impl-doc-path> [--date YYYY-MM-DD]
// Exits 0 on success, exits 1 on error.
func runMarkComplete(args []string) error {
	fs := flag.NewFlagSet("mark-complete", flag.ContinueOnError)
	dateFlag := fs.String("date", time.Now().Format("2006-01-02"), "Completion date (YYYY-MM-DD)")

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("mark-complete: %w", err)
	}

	if fs.NArg() < 1 {
		return fmt.Errorf("mark-complete: impl doc path is required\nUsage: saw mark-complete <impl-doc-path> [--date YYYY-MM-DD]")
	}

	implDocPath := fs.Arg(0)

	// Write the completion marker
	if err := protocol.WriteCompletionMarker(implDocPath, *dateFlag); err != nil {
		return fmt.Errorf("mark-complete: %w", err)
	}

	fmt.Printf("✓ Completion marker written to %s (date: %s)\n", implDocPath, *dateFlag)
	return nil
}
