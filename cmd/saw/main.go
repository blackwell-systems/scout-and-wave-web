package main

import (
	"fmt"
	"io"
	"os"
)

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
	case "--version", "-version":
		fmt.Println("saw v0.1.0")
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
  wave    Execute agents for a wave from an IMPL doc
  status  Show current wave/agent status from an IMPL doc

Flags:
  --impl <path>   Path to IMPL doc (required)
  --wave <n>      Wave number to execute (default: 1)
  --version       Print version and exit
  --help          Print this help and exit
`)
}
