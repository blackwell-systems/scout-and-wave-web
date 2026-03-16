package api

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// ParseAndEmitProgress is called for each agent_tool_call event.
// It parses the tool call to extract progress info, updates the progress tracker,
// and emits an agent_progress SSE event.
func (s *Server) ParseAndEmitProgress(ev SSEEvent, slug string) {
	// 1. Assert ev.Event == "agent_tool_call"
	if ev.Event != "agent_tool_call" {
		return
	}

	// 2. Type-assert ev.Data to AgentToolCallPayload
	payload, ok := ev.Data.(AgentToolCallPayload)
	if !ok {
		// Try pointer form
		if p, ok2 := ev.Data.(*AgentToolCallPayload); ok2 && p != nil {
			payload = *p
		} else {
			return
		}
	}

	// 3. Skip if IsResult == true (only process tool invocations, not results)
	if payload.IsResult {
		return
	}

	agent := payload.Agent
	wave := payload.Wave
	toolName := payload.ToolName

	// 4. Parse Input field (JSON string) to detect tool name and extract params
	var inputParams map[string]interface{}
	if payload.Input != "" {
		_ = json.Unmarshal([]byte(payload.Input), &inputParams)
	}

	var currentFile string
	var currentAction string

	switch toolName {
	case "Write":
		// Extract file_path from Input JSON
		if fp, ok := inputParams["file_path"].(string); ok {
			currentFile = fp
			currentAction = "Writing " + fp
		}

	case "Bash":
		// Extract command from Input JSON
		if cmd, ok := inputParams["command"].(string); ok {
			snippet := cmd
			if len(snippet) > 50 {
				snippet = snippet[:50]
			}
			currentAction = "Running " + snippet

			// 6. If command starts with "git commit", increment commitsMade counter
			if strings.HasPrefix(strings.TrimSpace(cmd), "git commit") {
				key := fmt.Sprintf("%s/%d/%s", slug, wave, agent)
				var newCount int
				if val, loaded := s.commitCounts.Load(key); loaded {
					newCount = val.(int) + 1
				} else {
					newCount = 1
				}
				s.commitCounts.Store(key, newCount)
			}
		}
	}

	// 7. Get filesOwned from IMPL doc (cached per agent)
	filesOwned := s.getFilesOwned(slug, wave, agent)

	// 8. Get current commit count for this agent
	commitsMade := 0
	key := fmt.Sprintf("%s/%d/%s", slug, wave, agent)
	if val, loaded := s.commitCounts.Load(key); loaded {
		commitsMade = val.(int)
	}

	// 9. Call s.progressTracker.Update(...)
	s.progressTracker.Update(slug, wave, agent, filesOwned, currentFile, currentAction, commitsMade)

	// 10. Retrieve updated progress
	progress := s.progressTracker.Get(slug, wave, agent)
	if progress == nil {
		return
	}

	// 11. Emit agent_progress SSE event
	s.broker.Publish(slug, SSEEvent{
		Event: "agent_progress",
		Data: AgentProgressPayload{
			Agent:         progress.Agent,
			Wave:          progress.Wave,
			CurrentFile:   progress.CurrentFile,
			CurrentAction: progress.CurrentAction,
			PercentDone:   progress.PercentDone,
		},
	})
}

// getFilesOwned returns the list of files owned by the given agent in the given wave.
// Results are cached in s.filesOwnedCache to avoid re-parsing the IMPL doc on every tool call.
func (s *Server) getFilesOwned(slug string, wave int, agent string) []string {
	cacheKey := fmt.Sprintf("%s/%d/%s", slug, wave, agent)

	if val, ok := s.filesOwnedCache.Load(cacheKey); ok {
		return val.([]string)
	}

	// Resolve the IMPL doc path
	implPath, _, err := s.resolveIMPLPath(slug)
	if err != nil {
		return nil
	}

	manifest, err := protocol.Load(implPath)
	if err != nil {
		return nil
	}

	var files []string
	for _, fo := range manifest.FileOwnership {
		if fo.Wave == wave && fo.Agent == agent {
			files = append(files, fo.File)
		}
	}

	s.filesOwnedCache.Store(cacheKey, files)
	return files
}
