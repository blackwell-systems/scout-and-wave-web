package main

import (
	"fmt"
	"io"
	"os"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"gopkg.in/yaml.v3"
)

// runSetCompletion reads a YAML completion report from stdin and registers it
// in the manifest at the specified path for the given agent ID.
// Args: [manifest-path, agent-id]
// Usage: saw set-completion <manifest-path> <agent-id> < completion-report.yaml
func runSetCompletion(args []string) error {
	if len(args) < 2 {
		return fmt.Errorf("set-completion: manifest-path and agent-id are required\nUsage: saw set-completion <manifest-path> <agent-id> < completion-report.yaml")
	}

	manifestPath := args[0]
	agentID := args[1]

	// Read YAML from stdin.
	yamlBytes, err := io.ReadAll(os.Stdin)
	if err != nil {
		return fmt.Errorf("set-completion: failed to read stdin: %w", err)
	}

	// Parse YAML into CompletionReport.
	var report protocol.CompletionReport
	if err := yaml.Unmarshal(yamlBytes, &report); err != nil {
		return fmt.Errorf("set-completion: failed to parse YAML: %w", err)
	}

	// Validate status field.
	if report.Status != "complete" && report.Status != "partial" && report.Status != "blocked" {
		return fmt.Errorf("set-completion: invalid status %q (must be complete, partial, or blocked)", report.Status)
	}

	// Load manifest.
	manifest, err := protocol.Load(manifestPath)
	if err != nil {
		return fmt.Errorf("set-completion: failed to load manifest: %w", err)
	}

	// Register completion report.
	if err := protocol.SetCompletionReport(manifest, agentID, report); err != nil {
		return fmt.Errorf("set-completion: %w", err)
	}

	// Save manifest back.
	if err := protocol.Save(manifest, manifestPath); err != nil {
		return fmt.Errorf("set-completion: failed to save manifest: %w", err)
	}

	fmt.Printf("✓ Completion report registered for agent %s\n", agentID)
	return nil
}
