package orchestrator

import (
	"fmt"
	"os/exec"
	"strings"
)

func init() {
	runVerificationFunc = runVerification
}

// runVerification runs testCommand in o.repoPath. Returns nil on exit 0.
func runVerification(o *Orchestrator, testCommand string) error {
	parts := strings.Fields(testCommand)
	if len(parts) == 0 {
		return fmt.Errorf("runVerification: empty test command")
	}

	cmd := exec.Command(parts[0], parts[1:]...)
	cmd.Dir = o.repoPath

	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("runVerification: command %q failed: %w\noutput: %s", testCommand, err, string(out))
	}

	return nil
}
