package main

import "github.com/spf13/cobra"

// repoDir is the repository root directory, bound via --repo-dir persistent flag.
var repoDir string

func newRootCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "saw",
		Short:   "SAW Orchestration CLI with embedded web UI",
		Version: version,
	}
	cmd.PersistentFlags().StringVar(&repoDir, "repo-dir", ".", "Repository root directory")
	return cmd
}
