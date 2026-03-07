package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/orchestrator"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

// runWave executes a wave from an IMPL doc.
// Args: ["--impl", "<path>", "--wave", "<n>"] (or subsets).
func runWave(args []string) error {
	fs := flag.NewFlagSet("wave", flag.ContinueOnError)
	implPath := fs.String("impl", "", "Path to IMPL doc (required)")
	waveNum := fs.Int("wave", 1, "Wave number to execute (default: 1)")

	if err := fs.Parse(args); err != nil {
		return fmt.Errorf("wave: %w", err)
	}

	if *implPath == "" {
		return errors.New("wave: --impl is required")
	}

	repoPath, err := findRepoRoot(filepath.Dir(*implPath))
	if err != nil {
		return fmt.Errorf("wave: %w", err)
	}

	o, err := orchestrator.New(repoPath, *implPath)
	if err != nil {
		return fmt.Errorf("wave: %w", err)
	}

	// Advance through state machine: SuitabilityPending -> Reviewed -> WavePending
	if err := o.TransitionTo(types.Reviewed); err != nil {
		return fmt.Errorf("wave: %w", err)
	}
	if err := o.TransitionTo(types.WavePending); err != nil {
		return fmt.Errorf("wave: %w", err)
	}

	// Run agents for the wave (stub: prints progress message).
	fmt.Printf("Wave %d agents running...\n", *waveNum)
	if err := o.RunWave(*waveNum); err != nil {
		return fmt.Errorf("wave: %w", err)
	}

	if err := o.TransitionTo(types.WaveExecuting); err != nil {
		return fmt.Errorf("wave: %w", err)
	}

	// Merge worktrees for this wave.
	if err := o.MergeWave(*waveNum); err != nil {
		return fmt.Errorf("wave: merge failed: %w", err)
	}

	// Run post-merge verification.
	if err := o.RunVerification("go test ./..."); err != nil {
		return fmt.Errorf("wave: verification failed: %w", err)
	}

	if err := o.TransitionTo(types.WaveMerged); err != nil {
		return fmt.Errorf("wave: %w", err)
	}

	fmt.Printf("Wave %d complete.\n", *waveNum)
	return nil
}

// runStatus prints current state of an IMPL doc.
func runStatus(args []string) error {
	fs := flag.NewFlagSet("status", flag.ContinueOnError)
	implPath := fs.String("impl", "", "Path to IMPL doc (required)")

	if err := fs.Parse(args); err != nil {
		return fmt.Errorf("status: %w", err)
	}

	if *implPath == "" {
		return errors.New("status: --impl is required")
	}

	doc, err := protocol.ParseIMPLDoc(*implPath)
	if err != nil {
		return fmt.Errorf("status: %w", err)
	}

	fmt.Printf("IMPL: %s\n", doc.FeatureName)

	for _, wave := range doc.Waves {
		fmt.Printf("\nWave %d:\n", wave.Number)
		for _, agent := range wave.Agents {
			report, err := protocol.ParseCompletionReport(*implPath, agent.Letter)
			if err != nil {
				if errors.Is(err, protocol.ErrReportNotFound) {
					fmt.Printf("  Agent %s: pending\n", agent.Letter)
				} else {
					fmt.Printf("  Agent %s: error reading report: %v\n", agent.Letter, err)
				}
				continue
			}
			fmt.Printf("  Agent %s: %s\n", agent.Letter, report.Status)
		}
	}

	return nil
}

// findRepoRoot walks upward from startPath until it finds a directory
// containing .git. Returns the directory containing .git, or an error if
// the filesystem root is reached without finding one.
func findRepoRoot(startPath string) (string, error) {
	// Resolve symlinks to get a clean absolute path.
	resolved, err := filepath.EvalSymlinks(startPath)
	if err != nil {
		// Fall back to the original path if symlink resolution fails.
		resolved = startPath
	}

	dir, err := filepath.Abs(resolved)
	if err != nil {
		return "", fmt.Errorf("findRepoRoot: cannot resolve absolute path for %q: %w", startPath, err)
	}

	for {
		candidate := filepath.Join(dir, ".git")
		if _, err := os.Stat(candidate); err == nil {
			return dir, nil
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			// Reached the filesystem root without finding .git.
			return "", fmt.Errorf("findRepoRoot: no .git directory found above %q", startPath)
		}
		dir = parent
	}
}
