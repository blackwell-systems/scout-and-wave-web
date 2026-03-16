package main

import (
	"github.com/spf13/cobra"
)

func newServeCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "serve",
		Short:              "Start a local HTTP server for reviewing IMPL docs",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runServe(args)
		},
	}
}

func newWaveCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "wave",
		Short:              "Execute agents for a wave from an IMPL doc",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runWave(args)
		},
	}
}

func newStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "status",
		Short:              "Show current wave/agent status from an IMPL doc",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runStatus(args)
		},
	}
}

func newScoutCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "scout",
		Short:              "Run a Scout agent to generate an IMPL doc for a feature",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runScout(args)
		},
	}
}

func newScaffoldCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "scaffold",
		Short:              "Run a Scaffold agent to set up worktrees from an IMPL doc",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runScaffold(args)
		},
	}
}

func newValidateCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "validate",
		Short:              "Validate a YAML IMPL manifest against protocol invariants",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runValidate(args)
		},
	}
}

func newMergeCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "merge",
		Short:              "Merge agent worktrees for a completed wave",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runMerge(args)
		},
	}
}

func newMergeWaveCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "merge-wave",
		Short:              "Check if a wave is ready to merge and output JSON status",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runMergeWave(args)
		},
	}
}

func newCurrentWaveCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "current-wave",
		Short:              "Return the wave number of the first incomplete wave",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runCurrentWave(args)
		},
	}
}

func newRenderCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "render",
		Short:              "Render a YAML IMPL manifest as markdown",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runRender(args)
		},
	}
}

func newExtractContextCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "extract-context",
		Short:              "Extract agent-specific context from an IMPL manifest as JSON",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runExtractContext(args)
		},
	}
}

func newSetCompletionCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "set-completion",
		Short:              "Register a completion report for an agent in a manifest",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runSetCompletion(args)
		},
	}
}

func newCheckConflictsCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "check-conflicts",
		Short:              "Detect file ownership conflicts across agents",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runCheckConflicts(args)
		},
	}
}

func newFreezeCheckCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "freeze-check",
		Short:              "Check for interface contract freeze violations",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runFreezeCheck(args)
		},
	}
}

func newMarkCompleteCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "mark-complete",
		Short:              "Write SAW:COMPLETE marker to an IMPL doc",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runMarkComplete(args)
		},
	}
}

func newRunGatesCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "run-gates",
		Short:              "Run quality gate checks for a wave",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runRunGates(args)
		},
	}
}

func newValidateScaffoldsCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "validate-scaffolds",
		Short:              "Validate scaffold file status in a manifest",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runValidateScaffolds(args)
		},
	}
}

func newUpdateAgentPromptCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "update-agent-prompt",
		Short:              "Update an agent's task prompt in a manifest",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runUpdateAgentPrompt(args)
		},
	}
}

func newAnalyzeDepsCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "analyze-deps",
		Short:              "Analyze Go repository dependencies and produce dependency graph",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAnalyzeDeps(args)
		},
	}
}

func newAnalyzeSuitabilityCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "analyze-suitability",
		Short:              "Scan codebase for pre-implementation status of requirements",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAnalyzeSuitability(args)
		},
	}
}

func newDetectCascadesCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "detect-cascades",
		Short:              "Detect cascade candidates from type renames via AST analysis",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runDetectCascades(args)
		},
	}
}

func newDetectScaffoldsCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "detect-scaffolds",
		Short:              "Detect shared types that need scaffold files from interface contracts",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runDetectScaffolds(args)
		},
	}
}

func newExtractCommandsCmd() *cobra.Command {
	return &cobra.Command{
		Use:                "extract-commands",
		Short:              "Extract build/test/lint/format commands from CI configs and manifests",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runExtractCommands(args)
		},
	}
}
