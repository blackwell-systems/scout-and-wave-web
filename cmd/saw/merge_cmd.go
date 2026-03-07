package main

import (
	"errors"
	"flag"
	"fmt"
	"path/filepath"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/orchestrator"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

// runMerge parses --impl and --wave flags, constructs an Orchestrator,
// and runs MergeWave for the given wave number.
// It does NOT run verification (that is runWave's responsibility).
// Flags: --impl <path> (required), --wave <n> (default: 1)
func runMerge(args []string) error {
	fs := flag.NewFlagSet("merge", flag.ContinueOnError)
	implPath := fs.String("impl", "", "Path to IMPL doc (required)")
	waveNum := fs.Int("wave", 1, "Wave number to merge (default: 1)")

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("merge: %w", err)
	}

	if *implPath == "" {
		return fmt.Errorf("merge: --impl flag is required\nRun 'saw merge --help' for usage.")
	}

	repoPath, err := findRepoRoot(filepath.Dir(*implPath))
	if err != nil {
		// Fall back to the directory containing the IMPL doc.
		repoPath = filepath.Dir(*implPath)
	}

	o, err := orchestrator.New(repoPath, *implPath)
	if err != nil {
		return fmt.Errorf("merge: %w", err)
	}

	// Advance state machine: ScoutPending -> Reviewed -> WavePending -> WaveExecuting -> WaveMerging
	for _, state := range []types.State{types.Reviewed, types.WavePending, types.WaveExecuting, types.WaveMerging} {
		if err := o.TransitionTo(state); err != nil {
			return fmt.Errorf("merge: %w", err)
		}
	}

	if err := o.MergeWave(*waveNum); err != nil {
		return fmt.Errorf("merge: %w", err)
	}

	fmt.Printf("Wave %d merged successfully.\n", *waveNum)
	return nil
}
