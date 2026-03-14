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

	engine "github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

// waveOrchestrator is the minimal interface runWave needs from an Orchestrator.
// Using an interface enables tests to inject a fake without real git/API calls.
type waveOrchestrator interface {
	TransitionTo(newState protocol.ProtocolState) error
	RunWave(waveNum int) error
	MergeWave(waveNum int) error
	RunVerification(testCommand string) error
	UpdateIMPLStatus(waveNum int) error
	IMPLDoc() *types.IMPLDoc
}

// engineOrchAdapter wraps the engine package functions to satisfy waveOrchestrator.
// It holds the IMPL doc parsed at construction time so IMPLDoc() can return it.
type engineOrchAdapter struct {
	repoPath string
	implPath string
	doc      *types.IMPLDoc
	// state tracks the current protocol state (simplified; engine handles real state).
	state protocol.ProtocolState
}

func (a *engineOrchAdapter) TransitionTo(newState protocol.ProtocolState) error {
	a.state = newState
	return nil
}

func (a *engineOrchAdapter) RunWave(waveNum int) error {
	return engine.RunSingleWave(context.Background(), engine.RunWaveOpts{
		IMPLPath: a.implPath,
		RepoPath: a.repoPath,
	}, waveNum, func(ev engine.Event) {
		fmt.Printf("[%s] %v\n", ev.Event, ev.Data)
	})
}

func (a *engineOrchAdapter) MergeWave(waveNum int) error {
	return engine.MergeWave(context.Background(), engine.RunMergeOpts{
		IMPLPath: a.implPath,
		RepoPath: a.repoPath,
		WaveNum:  waveNum,
	})
}

func (a *engineOrchAdapter) RunVerification(testCommand string) error {
	return engine.RunVerification(context.Background(), engine.RunVerificationOpts{
		RepoPath:    a.repoPath,
		TestCommand: testCommand,
	})
}

func (a *engineOrchAdapter) UpdateIMPLStatus(waveNum int) error {
	if a.doc == nil {
		return nil
	}
	var letters []string
	for _, w := range a.doc.Waves {
		if w.Number == waveNum {
			for _, ag := range w.Agents {
				letters = append(letters, ag.Letter)
			}
			break
		}
	}
	return engine.UpdateIMPLStatus(a.implPath, letters)
}

func (a *engineOrchAdapter) IMPLDoc() *types.IMPLDoc {
	return a.doc
}

// orchestratorNewFunc is a seam for tests: creates a waveOrchestrator from a
// repo path and IMPL doc path. Tests can replace this to inject a fake.
var orchestratorNewFunc = func(repoPath, implPath string) (waveOrchestrator, error) {
	doc, err := engine.ParseIMPLDoc(implPath)
	if err != nil {
		return nil, fmt.Errorf("cannot parse IMPL doc: %w", err)
	}
	if doc == nil {
		return nil, fmt.Errorf("cannot parse IMPL doc: %s", implPath)
	}
	return &engineOrchAdapter{
		repoPath: repoPath,
		implPath: implPath,
		doc:      doc,
		state:    protocol.StateScoutPending,
	}, nil
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
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("wave: %w", err)
	}

	if *implPath == "" {
		return errors.New("wave: --impl is required\nRun 'saw wave --help' for usage.")
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
	if err := o.TransitionTo(protocol.StateReviewed); err != nil {
		return fmt.Errorf("wave: %w", err)
	}
	if err := o.TransitionTo(protocol.StateWavePending); err != nil {
		return fmt.Errorf("wave: %w", err)
	}

	// Build the ordered list of waves to execute, starting from *waveNum.
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
			if err := o.TransitionTo(protocol.StateWavePending); err != nil {
				return fmt.Errorf("wave: %w", err)
			}
		}

		// Run agents for the current wave.
		fmt.Printf("Wave %d agents running...\n", currentWaveNum)
		if err := o.RunWave(currentWaveNum); err != nil {
			return fmt.Errorf("wave: %w", err)
		}

		if err := o.TransitionTo(protocol.StateWaveExecuting); err != nil {
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

		if err := o.TransitionTo(protocol.StateWaveVerified); err != nil {
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
	if err := o.TransitionTo(protocol.StateComplete); err != nil {
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
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("status: %w", err)
	}

	if *implPath == "" {
		return errors.New("status: --impl is required\nRun 'saw status --help' for usage.")
	}

	doc, err := engine.ParseIMPLDoc(*implPath)
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
		Total    int `json:"total"`
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
			report, rptErr := engine.ParseCompletionReport(*implPath, ag.Letter)
			if rptErr != nil {
				if errors.Is(rptErr, engine.ErrReportNotFound) {
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
	fs.String("backend", "", "Backend to use: api, cli, or auto (default: auto; env: SAW_BACKEND)")

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("scout: %w", err)
	}

	if *feature == "" {
		return errors.New("scout: --feature is required\nRun 'saw scout --help' for usage.")
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
		implOut = filepath.Join(repoRoot, "docs", "IMPL", fmt.Sprintf("IMPL-%s.yaml", slug))
	}

	// Locate and read scout.md to verify it exists (engine will re-read it).
	scoutMdPath, err := locatePromptFile(filepath.Join("prompts", "scout.md"))
	if err != nil {
		return fmt.Errorf("scout: %w", err)
	}

	sawRepo := filepath.Dir(filepath.Dir(scoutMdPath))

	ctx := context.Background()
	if err := engine.RunScout(ctx, engine.RunScoutOpts{
		Feature:     *feature,
		RepoPath:    repoRoot,
		SAWRepoPath: sawRepo,
		IMPLOutPath: implOut,
	}, func(s string) { fmt.Print(s) }); err != nil {
		return fmt.Errorf("scout: %w", err)
	}

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
	fs.String("backend", "", "Backend to use: api, cli, or auto (default: auto; env: SAW_BACKEND)")

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("scaffold: %w", err)
	}

	if *implPath == "" {
		return errors.New("scaffold: --impl is required\nRun 'saw scaffold --help' for usage.")
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

	// Locate scaffold-agent.md to verify it exists and resolve sawRepo.
	scaffoldMdPath, err := locatePromptFile(filepath.Join("prompts", "scaffold-agent.md"))
	if err != nil {
		return fmt.Errorf("scaffold: %w", err)
	}

	sawRepo := filepath.Dir(filepath.Dir(scaffoldMdPath))

	ctx := context.Background()
	if err := engine.RunScaffold(ctx, absImpl, repoRoot, sawRepo, func(ev engine.Event) {
		fmt.Println(ev.Event)
	}); err != nil {
		return fmt.Errorf("scaffold: %w", err)
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
