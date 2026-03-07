package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/orchestrator"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

func init() {
	orchestrator.SetValidateInvariantsFunc(protocol.ValidateInvariants)
}

// runWave executes a wave from an IMPL doc.
// Args: ["--impl", "<path>", "--wave", "<n>", "--auto"] (or subsets).
func runWave(args []string) error {
	fs := flag.NewFlagSet("wave", flag.ContinueOnError)
	implPath := fs.String("impl", "", "Path to IMPL doc (required)")
	waveNum := fs.Int("wave", 1, "Wave number to execute (default: 1)")
	auto := fs.Bool("auto", false, "Skip inter-wave approval prompts (default: false)")

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

	// Run post-merge verification using command from IMPL doc (fallback to go test).
	testCmd := o.IMPLDoc().TestCommand
	if testCmd == "" {
		testCmd = "go test ./..."
	}
	if err := o.RunVerification(testCmd); err != nil {
		return fmt.Errorf("wave: verification failed: %w", err)
	}

	if err := o.TransitionTo(types.WaveVerified); err != nil {
		return fmt.Errorf("wave: %w", err)
	}

	fmt.Printf("Wave %d complete.\n", *waveNum)
	if !*auto {
		fmt.Print("Wave complete. Press Enter to proceed...")
		bufio.NewReader(os.Stdin).ReadString('\n') //nolint:errcheck
	} else {
		fmt.Println("Wave complete. Proceeding...")
	}
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

// slugify converts a feature description to a URL-safe slug for use in file names.
func slugify(s string) string {
	s = strings.ToLower(s)
	re := regexp.MustCompile(`[^a-z0-9]+`)
	s = re.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 40 {
		s = s[:40]
	}
	return s
}

// locatePromptFile returns the path to a prompt file, checking $SAW_REPO first,
// then falling back to ~/code/scout-and-wave.
func locatePromptFile(relPath string) (string, error) {
	sawRepo := os.Getenv("SAW_REPO")
	if sawRepo == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("cannot determine home directory: %w", err)
		}
		sawRepo = filepath.Join(home, "code", "scout-and-wave")
	}
	p := filepath.Join(sawRepo, relPath)
	if _, err := os.Stat(p); err == nil {
		return p, nil
	}
	return "", fmt.Errorf("prompt file not found: %s", p)
}

// runScout launches a real Scout agent via the Anthropic API with file/shell tool access.
// Flags:
//
//	--feature <description>  one-line feature description (required)
//	--impl <path>            output path for IMPL doc (optional)
//	--repo <path>            repository root (optional; default: auto-detected from cwd)
func runScout(args []string) error {
	fs := flag.NewFlagSet("scout", flag.ContinueOnError)
	feature := fs.String("feature", "", "One-line feature description (required)")
	implPath := fs.String("impl", "", "Output path for IMPL doc (optional)")
	repoFlag := fs.String("repo", "", "Repository root (optional; default: auto-detect from cwd)")

	if err := fs.Parse(args); err != nil {
		return fmt.Errorf("scout: %w", err)
	}

	if *feature == "" {
		return errors.New("scout: --feature is required")
	}

	// Resolve repoRoot.
	var repoRoot string
	if *repoFlag != "" {
		repoRoot = *repoFlag
	} else {
		cwd, err := os.Getwd()
		if err != nil {
			return fmt.Errorf("scout: cannot get cwd: %w", err)
		}
		repoRoot, err = findRepoRoot(cwd)
		if err != nil {
			return fmt.Errorf("scout: %w", err)
		}
	}

	// Determine IMPL output path.
	implOut := *implPath
	if implOut == "" {
		slug := slugify(*feature)
		implOut = filepath.Join(repoRoot, "docs", "IMPL", fmt.Sprintf("IMPL-%s.md", slug))
	}

	// Locate and read scout.md.
	scoutMdPath, err := locatePromptFile(filepath.Join("prompts", "scout.md"))
	if err != nil {
		return fmt.Errorf("scout: %w", err)
	}
	scoutMdBytes, err := os.ReadFile(scoutMdPath)
	if err != nil {
		return fmt.Errorf("scout: cannot read scout.md: %w", err)
	}

	prompt := fmt.Sprintf("%s\n\n## Feature\n%s\n\n## IMPL Output Path\n%s\n",
		string(scoutMdBytes), *feature, implOut)

	client := agent.NewClient("")
	runner := agent.NewRunner(client, nil)
	spec := types.AgentSpec{Letter: "scout", Prompt: prompt}

	ctx := context.Background()
	result, err := runner.ExecuteWithTools(ctx, &spec, repoRoot, agent.StandardTools(repoRoot), 80)
	if err != nil {
		return fmt.Errorf("scout: %w", err)
	}

	fmt.Println(result)
	return nil
}

// runScaffold launches a real Scaffold agent via the Anthropic API with file/shell tool access.
// Flags:
//
//	--impl <path>  path to IMPL doc (required)
func runScaffold(args []string) error {
	fs := flag.NewFlagSet("scaffold", flag.ContinueOnError)
	implPath := fs.String("impl", "", "Path to IMPL doc (required)")
	repoFlag := fs.String("repo", "", "Repository root (optional; default: auto-detect from cwd)")

	if err := fs.Parse(args); err != nil {
		return fmt.Errorf("scaffold: %w", err)
	}

	if *implPath == "" {
		return errors.New("scaffold: --impl is required")
	}

	// Resolve absolute IMPL path.
	absImpl, err := filepath.Abs(*implPath)
	if err != nil {
		return fmt.Errorf("scaffold: cannot resolve impl path: %w", err)
	}

	// Resolve repoRoot.
	var repoRoot string
	if *repoFlag != "" {
		repoRoot = *repoFlag
	} else {
		cwd, err := os.Getwd()
		if err != nil {
			return fmt.Errorf("scaffold: cannot get cwd: %w", err)
		}
		repoRoot, err = findRepoRoot(cwd)
		if err != nil {
			return fmt.Errorf("scaffold: %w", err)
		}
	}

	// Parse IMPL doc to validate it exists and is parseable.
	if _, err := protocol.ParseIMPLDoc(absImpl); err != nil {
		return fmt.Errorf("scaffold: cannot parse IMPL doc: %w", err)
	}

	// Locate and read scaffold-agent.md.
	scaffoldMdPath, err := locatePromptFile(filepath.Join("prompts", "scaffold-agent.md"))
	if err != nil {
		return fmt.Errorf("scaffold: %w", err)
	}
	scaffoldMdBytes, err := os.ReadFile(scaffoldMdPath)
	if err != nil {
		return fmt.Errorf("scaffold: cannot read scaffold-agent.md: %w", err)
	}

	prompt := fmt.Sprintf("%s\n\n## IMPL Doc Path\n%s\n", string(scaffoldMdBytes), absImpl)

	client := agent.NewClient("")
	runner := agent.NewRunner(client, nil)
	spec := types.AgentSpec{Letter: "scaffold", Prompt: prompt}

	ctx := context.Background()
	result, err := runner.ExecuteWithTools(ctx, &spec, repoRoot, agent.StandardTools(repoRoot), 40)
	if err != nil {
		return fmt.Errorf("scaffold: %w", err)
	}

	fmt.Println(result)
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
