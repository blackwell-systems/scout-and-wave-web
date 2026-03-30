package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strconv"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// runMergeWave checks if all agents in the specified wave are complete
// and ready to merge.
// Command: saw merge-wave <manifest-path> <wave-number>
// Exit 0 with JSON status if ready, exit 1 if not ready.
func runMergeWave(args []string) error {
	fs := flag.NewFlagSet("merge-wave", flag.ContinueOnError)

	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return fmt.Errorf("merge-wave: %w", err)
	}

	if fs.NArg() < 2 {
		return fmt.Errorf("merge-wave: manifest path and wave number are required\nUsage: saw merge-wave <manifest-path> <wave-number>")
	}

	manifestPath := fs.Arg(0)
	waveNumStr := fs.Arg(1)

	waveNum, err := strconv.Atoi(waveNumStr)
	if err != nil {
		return fmt.Errorf("merge-wave: invalid wave number %q: %w", waveNumStr, err)
	}

	// Load the manifest
	manifest, err := protocol.Load(manifestPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("merge-wave: manifest file not found: %s", manifestPath)
		}
		return fmt.Errorf("merge-wave: %w", err)
	}

	// Find the specified wave
	var targetWave *protocol.Wave
	for i := range manifest.Waves {
		if manifest.Waves[i].Number == waveNum {
			targetWave = &manifest.Waves[i]
			break
		}
	}

	if targetWave == nil {
		return fmt.Errorf("merge-wave: wave %d not found in manifest", waveNum)
	}

	// Check completion status of all agents in the wave
	type agentStatus struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Ready  bool   `json:"ready"`
	}

	type waveStatus struct {
		Wave       int           `json:"wave"`
		Ready      bool          `json:"ready"`
		Agents     []agentStatus `json:"agents"`
		NotReady   []string      `json:"not_ready,omitempty"`
	}

	status := waveStatus{
		Wave:   waveNum,
		Ready:  true,
		Agents: make([]agentStatus, 0, len(targetWave.Agents)),
	}

	for _, agent := range targetWave.Agents {
		report, exists := manifest.CompletionReports[agent.ID]
		agentReady := exists && report.Status == "complete"

		agentStat := agentStatus{
			ID:     agent.ID,
			Status: "pending",
			Ready:  agentReady,
		}

		if exists {
			agentStat.Status = string(report.Status)
		}

		status.Agents = append(status.Agents, agentStat)

		if !agentReady {
			status.Ready = false
			status.NotReady = append(status.NotReady, agent.ID)
		}
	}

	// Output JSON status
	statusJSON, err := json.MarshalIndent(status, "", "  ")
	if err != nil {
		return fmt.Errorf("merge-wave: failed to marshal JSON: %w", err)
	}

	fmt.Println(string(statusJSON))

	if !status.Ready {
		os.Exit(1)
	}

	return nil
}
