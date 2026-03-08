package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	engine "github.com/blackwell-systems/scout-and-wave-go/pkg/engine"
	etypes "github.com/blackwell-systems/scout-and-wave-go/pkg/types"
)

// handleGetAgentContext serves GET /api/impl/{slug}/agent/{letter}/context.
// Parses the IMPL doc to extract the agent's prompt section, interface contracts,
// and file ownership rows, then returns them as AgentContextResponse JSON.
func (s *Server) handleGetAgentContext(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	letter := strings.ToUpper(r.PathValue("letter"))
	if slug == "" || letter == "" {
		http.Error(w, "missing slug or agent letter", http.StatusBadRequest)
		return
	}

	implPath := filepath.Join(s.cfg.IMPLDir, "IMPL-"+slug+".md")

	doc, err := engine.ParseIMPLDoc(implPath)
	if err != nil {
		if isNotExistErr(err) {
			http.Error(w, "IMPL doc not found", http.StatusNotFound)
			return
		}
		http.Error(w, "failed to parse IMPL doc", http.StatusInternalServerError)
		return
	}

	// Find the agent in the parsed waves
	agentWave := 0
	agentPrompt := ""
	for _, wave := range doc.Waves {
		for _, agent := range wave.Agents {
			if strings.EqualFold(agent.Letter, letter) {
				agentWave = wave.Number
				agentPrompt = agent.Prompt
				break
			}
		}
		if agentWave != 0 {
			break
		}
	}

	// Build context text: agent prompt + interface contracts + file ownership rows
	contextText := buildAgentContextText(letter, agentPrompt, doc.InterfaceContractsText, doc.FileOwnership)

	// If the parser found no prompt, fall back to raw doc extraction
	if agentPrompt == "" {
		rawData, readErr := os.ReadFile(implPath)
		if readErr == nil {
			extracted := extractAgentSection(string(rawData), letter)
			if extracted != "" {
				contextText = buildAgentContextText(letter, extracted, doc.InterfaceContractsText, doc.FileOwnership)
			}
		}
	}

	resp := AgentContextResponse{
		Slug:        slug,
		Agent:       letter,
		Wave:        agentWave,
		ContextText: contextText,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

// buildAgentContextText assembles context markdown for a specific agent letter.
// Concatenates: agent prompt section, interface contracts, file ownership rows.
func buildAgentContextText(letter, agentPrompt, interfaceContracts string, fileOwnership map[string]etypes.FileOwnershipInfo) string {
	var sb strings.Builder

	if agentPrompt != "" {
		sb.WriteString(agentPrompt)
		sb.WriteString("\n\n")
	}

	if interfaceContracts != "" {
		sb.WriteString("## Interface Contracts\n\n")
		sb.WriteString(interfaceContracts)
		sb.WriteString("\n\n")
	}

	// Append file ownership rows that belong to this agent
	var ownershipLines []string
	for file, info := range fileOwnership {
		if strings.EqualFold(info.Agent, letter) {
			ownershipLines = append(ownershipLines, fmt.Sprintf("- `%s` (wave %d, %s)", file, info.Wave, info.Action))
		}
	}
	if len(ownershipLines) > 0 {
		sb.WriteString("## File Ownership\n\n")
		for _, line := range ownershipLines {
			sb.WriteString(line)
			sb.WriteString("\n")
		}
	}

	return strings.TrimSpace(sb.String())
}

// extractAgentSection scans the raw IMPL doc for a heading like "### Agent C"
// and returns the content of that section until the next same-level heading.
func extractAgentSection(rawDoc, letter string) string {
	lines := strings.Split(rawDoc, "\n")
	target := "### Agent " + strings.ToUpper(letter)
	inSection := false
	var sectionLines []string

	for _, line := range lines {
		if inSection {
			if strings.HasPrefix(line, "### ") || strings.HasPrefix(line, "## ") {
				break
			}
			sectionLines = append(sectionLines, line)
		} else if strings.HasPrefix(line, target) {
			inSection = true
			sectionLines = append(sectionLines, line)
		}
	}

	return strings.Join(sectionLines, "\n")
}
