package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend/api"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/agent/backend/cli"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/orchestrator"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

func init() {
	orchestrator.SetValidateInvariantsFunc(protocol.ValidateInvariants)
}

// waveOrchestrator is the minimal interface runWave needs from an Orchestrator.
// Using an interface enables tests to inject a fake without real git/API calls.
type waveOrchestrator interface {
	TransitionTo(newState types.State) error
	RunWave(waveNum int) error
	MergeWave(waveNum int) error
	RunVerification(testCommand string) error
	UpdateIMPLStatus(waveNum int) error
	IMPLDoc() *types.IMPLDoc
}

// orchestratorNewFunc is a seam for tests: creates a waveOrchestrator from a
// repo path and IMPL doc path. Tests can replace this to inject a fake.
var orchestratorNewFunc = func(repoPath, implPath string) (waveOrchestrator, error) {
	return orchestrator.New(repoPath, implPath)
}

// resolveBackend returns a backend.Backend based on kind and cfg.
// kind precedence: explicit flag value > SAW_BACKEND env var > "auto".
// "auto" selects api when ANTHROPIC_API_KEY is set, otherwise cli.
func resolveBackend(kind string, cfg backend.Config) (backend.Backend, error) {
	if kind == "" {
		kind = os.Getenv("SAW_BACKEND")
	}
	if kind == "" {
		kind = "auto"
	}
	switch kind {
	case "api":
		return api.New(os.Getenv("ANTHROPIC_API_KEY"), cfg), nil
	case "cli":
		return cli.New("", cfg), nil
	case "auto":
		if os.Getenv("ANTHROPIC_API_KEY") != "" {
			return api.New(os.Getenv("ANTHROPIC_API_KEY"), cfg), nil
		}
		return cli.New("", cfg), nil
	default:
		return nil, fmt.Errorf("unknown backend kind %q; valid: api, cli, auto", kind)
	}
}

// runWave executes a wave from an IMPL doc.
// Args: ["--impl", "<path>", "--wave", "<n>", "--auto"] (or subsets).
// When --auto is set, iterates through all waves in the IMPL doc sequentially
// starting from --wave (default 1), without user prompts between waves.
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

	o, err := orchestratorNewFunc(repoPath, *implPath)
	if err != nil {
		return fmt.Errorf("wave: %w", err)
	}

	// Advance through state machine: ScoutPending -> Reviewed -> WavePending
	if err := o.TransitionTo(types.Reviewed); err != nil {
		return fmt.Errorf("wave: %w", err)
	}
	if err := o.TransitionTo(types.WavePending); err != nil {
		return fmt.Errorf("wave: %w", err)
	}

	// Build the ordered list of waves to execute, starting from *waveNum.
	// Waves are iterated in the order they appear in the IMPL doc (sorted by Number).
	waves := o.IMPLDoc().Waves
	// Find the index of the first wave with Number >= *waveNum.
	startIdx := len(waves)
	for i, w := range waves {
		if w.Number >= *waveNum {
			startIdx = i
			break
		}
	}

	// If no waves qualify, return immediately with no iterations.
	if startIdx == len(waves) {
		return nil
	}

	// Execute each wave in sequence.
	for idx := startIdx; idx < len(waves); idx++ {
		currentWaveNum := waves[idx].Number

		// For subsequent waves (after the first), transition back to WavePending.
		if idx > startIdx {
			if err := o.TransitionTo(types.WavePending); err != nil {
				return fmt.Errorf("wave: %w", err)
			}
		}

		// Run agents for the current wave.
		fmt.Printf("Wave %d agents running...\n", currentWaveNum)
		if err := o.RunWave(currentWaveNum); err != nil {
			return fmt.Errorf("wave: %w", err)
		}

		if err := o.TransitionTo(types.WaveExecuting); err != nil {
			return fmt.Errorf("wave: %w", err)
		}

		// Merge worktrees for this wave.
		if err := o.MergeWave(currentWaveNum); err != nil {
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

		// Tick IMPL doc status checkboxes for completed agents (non-fatal).
		if err := o.UpdateIMPLStatus(currentWaveNum); err != nil {
			fmt.Fprintf(os.Stderr, "wave: warning: UpdateIMPLStatus: %v\n", err)
		}

		if err := o.TransitionTo(types.WaveVerified); err != nil {
			return fmt.Errorf("wave: %w", err)
		}

		fmt.Printf("Wave %d complete.\n", currentWaveNum)

		// Check whether more waves remain.
		hasNext := idx+1 < len(waves)
		if hasNext {
			if !*auto {
				nextWaveNum := waves[idx+1].Number
				fmt.Printf("Wave %d complete. Press Enter to proceed to wave %d...", currentWaveNum, nextWaveNum)
				bufio.NewReader(os.Stdin).ReadString('\n') //nolint:errcheck
			} else {
				fmt.Println("Wave complete. Proceeding...")
			}
		}
	}

	// All waves executed — transition to Complete.
	if err := o.TransitionTo(types.Complete); err != nil {
		return fmt.Errorf("wave: %w", err)
	}
	fmt.Println("All waves complete.")
	return nil
}

// runStatus prints current state of an IMPL doc.
// Flags:
//
//	--impl    <path>  Path to IMPL doc (required)
//	--json           Output JSON instead of human-readable text (default: false)
//	--missing        List agents missing completion reports (human-readable only)
func runStatus(args []string) error {
	fs := flag.NewFlagSet("status", flag.ContinueOnError)
	implPath := fs.String("impl", "", "Path to IMPL doc (required)")
	jsonOut := fs.Bool("json", false, "Output JSON instead of human-readable text (default: false)")
	showMissing := fs.Bool("missing", false, "List agents missing completion reports (default: false)")

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

	// Local structs for JSON output shape.
	type jsonAgent struct {
		Letter string `json:"letter"`
		Status string `json:"status"`
	}
	type jsonWave struct {
		Number int         `json:"number"`
		Agents []jsonAgent `json:"agents"`
	}
	type jsonSummary struct {
		Total   int `json:"total"`
		Complete int `json:"complete"`
		Partial  int `json:"partial"`
		Blocked  int `json:"blocked"`
		Pending  int `json:"pending"`
	}
	type jsonOutput struct {
		Feature string      `json:"feature"`
		Waves   []jsonWave  `json:"waves"`
		Summary jsonSummary `json:"summary"`
	}

	// Collect per-wave agent statuses.
	type agentResult struct {
		waveNum int
		letter  string
		status  string // "complete", "partial", "blocked", "pending", or "error: ..."
		missing bool
	}

	var results []agentResult
	for _, wave := range doc.Waves {
		for _, ag := range wave.Agents {
			r := agentResult{waveNum: wave.Number, letter: ag.Letter}
			report, rptErr := protocol.ParseCompletionReport(*implPath, ag.Letter)
			if rptErr != nil {
				if errors.Is(rptErr, protocol.ErrReportNotFound) {
					r.status = "pending"
					r.missing = true
				} else {
					r.status = fmt.Sprintf("error: %v", rptErr)
				}
			} else {
				r.status = string(report.Status)
			}
			results = append(results, r)
		}
	}

	// Compute summary counts.
	var total, complete, partial, blocked, pending int
	for _, r := range results {
		total++
		switch r.status {
		case "complete":
			complete++
		case "partial":
			partial++
		case "blocked":
			blocked++
		default:
			pending++
		}
	}

	if *jsonOut {
		// Build structured JSON output.
		out := jsonOutput{
			Feature: doc.FeatureName,
			Summary: jsonSummary{
				Total:    total,
				Complete: complete,
				Partial:  partial,
				Blocked:  blocked,
				Pending:  pending,
			},
		}
		for _, wave := range doc.Waves {
			jw := jsonWave{Number: wave.Number}
			for _, r := range results {
				if r.waveNum == wave.Number {
					jw.Agents = append(jw.Agents, jsonAgent{Letter: r.letter, Status: r.status})
				}
			}
			out.Waves = append(out.Waves, jw)
		}
		data, merr := json.MarshalIndent(out, "", "  ")
		if merr != nil {
			return fmt.Errorf("status: failed to marshal JSON: %w", merr)
		}
		fmt.Println(string(data))
		return nil
	}

	// Human-readable output.
	fmt.Printf("IMPL: %s\n", doc.FeatureName)
	fmt.Printf("Agents: %d complete, %d pending, %d blocked\n", complete, pending, blocked)

	for _, wave := range doc.Waves {
		fmt.Printf("\nWave %d:\n", wave.Number)
		for _, r := range results {
			if r.waveNum == wave.Number {
				fmt.Printf("  Agent %s: %s\n", r.letter, r.status)
			}
		}
	}

	if *showMissing {
		var missing []agentResult
		for _, r := range results {
			if r.missing {
				missing = append(missing, r)
			}
		}
		if len(missing) > 0 {
			fmt.Printf("\nMissing reports:\n")
			for _, r := range missing {
				fmt.Printf("  Agent %s (wave %d)\n", r.letter, r.waveNum)
			}
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
	backendKind := fs.String("backend", "", "Backend to use: api, cli, or auto (default: auto; env: SAW_BACKEND)")

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

	b, err := resolveBackend(*backendKind, backend.Config{})
	if err != nil {
		return fmt.Errorf("scout: %w", err)
	}
	runner := agent.NewRunner(b, nil)
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
	backendKind := fs.String("backend", "", "Backend to use: api, cli, or auto (default: auto; env: SAW_BACKEND)")

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

	b, err := resolveBackend(*backendKind, backend.Config{})
	if err != nil {
		return fmt.Errorf("scaffold: %w", err)
	}
	runner := agent.NewRunner(b, nil)
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
