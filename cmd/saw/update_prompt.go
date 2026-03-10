package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// runUpdateAgentPrompt updates an agent's prompt field in the manifest.
// Command: saw update-agent-prompt <manifest-path> --agent <id>
// Reads the new prompt text from stdin.
func runUpdateAgentPrompt(args []string) error {
	fs := flag.NewFlagSet("update-agent-prompt", flag.ContinueOnError)
	agentID := fs.String("agent", "", "Agent ID (required)")

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("update-agent-prompt: %w", err)
	}

	if fs.NArg() < 1 {
		return fmt.Errorf("update-agent-prompt: manifest path is required\nUsage: saw update-agent-prompt <manifest-path> --agent <id>")
	}

	if *agentID == "" {
		return fmt.Errorf("update-agent-prompt: --agent flag is required\nUsage: saw update-agent-prompt <manifest-path> --agent <id>")
	}

	manifestPath := fs.Arg(0)

	// Read new prompt text from stdin
	promptBytes, err := io.ReadAll(os.Stdin)
	if err != nil {
		return fmt.Errorf("update-agent-prompt: failed to read stdin: %w", err)
	}

	newPrompt := string(promptBytes)

	// Load manifest
	manifest, err := protocol.Load(manifestPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("update-agent-prompt: manifest file not found: %s", manifestPath)
		}
		return fmt.Errorf("update-agent-prompt: %w", err)
	}

	// Update agent prompt
	if err := protocol.UpdateAgentPrompt(manifest, *agentID, newPrompt); err != nil {
		return fmt.Errorf("update-agent-prompt: %w", err)
	}

	// Save manifest back
	if err := protocol.Save(manifest, manifestPath); err != nil {
		return fmt.Errorf("update-agent-prompt: failed to save manifest: %w", err)
	}

	fmt.Printf("✓ Agent %s prompt updated\n", *agentID)
	return nil
}
