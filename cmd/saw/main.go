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
	case "serve":
		if err := runServe(os.Args[2:]); err != nil {
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
  wave      Execute agents for a wave from an IMPL doc
  status    Show current wave/agent status from an IMPL doc
  scout     Run a Scout agent to generate an IMPL doc for a feature
  scaffold  Run a Scaffold agent to set up worktrees from an IMPL doc
  merge     Merge agent worktrees for a completed wave
  serve     Start a local HTTP server for reviewing IMPL docs

Flags:
  --impl <path>   Path to IMPL doc (required)
  --wave <n>      Wave number to execute (default: 1)
  --version       Print version and exit
  --help          Print this help and exit
`)
}
