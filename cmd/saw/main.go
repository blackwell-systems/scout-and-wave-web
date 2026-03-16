package main

import (
	"fmt"
	"os"
)

var version = "dev"

func main() {
	rootCmd := newRootCmd()
	rootCmd.AddCommand(
		newServeCmd(),
		newWaveCmd(),
		newStatusCmd(),
		newScoutCmd(),
		newScaffoldCmd(),
		newValidateCmd(),
		newMergeCmd(),
		newMergeWaveCmd(),
		newCurrentWaveCmd(),
		newRenderCmd(),
		newExtractContextCmd(),
		newSetCompletionCmd(),
		newCheckConflictsCmd(),
		newFreezeCheckCmd(),
		newMarkCompleteCmd(),
		newRunGatesCmd(),
		newValidateScaffoldsCmd(),
		newUpdateAgentPromptCmd(),
		newAnalyzeDepsCmd(),
		newAnalyzeSuitabilityCmd(),
		newDetectCascadesCmd(),
		newDetectScaffoldsCmd(),
		newExtractCommandsCmd(),
	)
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
