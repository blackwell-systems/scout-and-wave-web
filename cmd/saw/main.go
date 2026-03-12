package main

import (
	"fmt"
	"io"
	"os"
)

// version is set at build time via -ldflags "-X main.version=...".
var version = "dev"

func main() {
	if len(os.Args) < 2 {
		printUsage(os.Stderr)
		os.Exit(1)
	}
	switch os.Args[1] {
	case "wave":
		if err := runWave(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "status":
		if err := runStatus(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "scout":
		if err := runScout(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "scaffold":
		if err := runScaffold(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "merge":
		if err := runMerge(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "merge-wave":
		if err := runMergeWave(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "current-wave":
		if err := runCurrentWave(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "serve":
		if err := runServe(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "validate":
		if err := runValidate(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "extract-context":
		if err := runExtractContext(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "set-completion":
		if err := runSetCompletion(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "render":
		if err := runRender(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "mark-complete":
		if err := runMarkComplete(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "run-gates":
		if err := runRunGates(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "check-conflicts":
		if err := runCheckConflicts(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "update-agent-prompt":
		if err := runUpdateAgentPrompt(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "validate-scaffolds":
		if err := runValidateScaffolds(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "freeze-check":
		if err := runFreezeCheck(os.Args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	case "--version", "-version":
		fmt.Printf("saw %s\n", version)
	case "--help", "-help", "help":
		printUsage(os.Stdout)
	default:
		fmt.Fprintf(os.Stderr, "unknown subcommand: %s\n", os.Args[1])
		printUsage(os.Stderr)
		os.Exit(1)
	}
}

// printUsage writes the CLI usage text to w.
func printUsage(w io.Writer) {
	fmt.Fprint(w, `Usage: saw <command> [flags]

Commands:
  wave            Execute agents for a wave from an IMPL doc
  status          Show current wave/agent status from an IMPL doc
  scout           Run a Scout agent to generate an IMPL doc for a feature
  scaffold        Run a Scaffold agent to set up worktrees from an IMPL doc
  merge           Merge agent worktrees for a completed wave
  merge-wave      Check if a wave is ready to merge and output JSON status
  current-wave    Return the wave number of the first incomplete wave
  serve           Start a local HTTP server for reviewing IMPL docs
  validate        Validate a YAML IMPL manifest against protocol invariants
  extract-context Extract agent-specific context from an IMPL manifest as JSON
  set-completion  Register a completion report for an agent in a manifest
  render          Render a YAML IMPL manifest as markdown
  mark-complete   Write SAW:COMPLETE marker to an IMPL doc
  run-gates       Run quality gate checks for a wave
  check-conflicts Detect file ownership conflicts across agents
  update-agent-prompt  Update an agent's task prompt in a manifest
  validate-scaffolds   Validate scaffold file status in a manifest
  freeze-check    Check for interface contract freeze violations

Global flags:
  --version   Print version and exit
  --help      Print this help and exit

Run 'saw <command> --help' for per-command flags.
`)
}
