package api

import (
	"fmt"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/result"
)

// LoadManifest loads a YAML manifest using the Protocol SDK.
// Returns the parsed manifest or an error if the file cannot be read or parsed.
func LoadManifest(yamlPath string) (*protocol.IMPLManifest, error) {
	manifest, err := protocol.Load(yamlPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load manifest: %w", err)
	}
	return manifest, nil
}

// ValidateManifest validates a YAML manifest and returns structured errors.
// Returns nil slice if validation passes, or a slice of validation errors.
// Returns a non-nil error only if the file cannot be loaded.
//
// Uses protocol.FullValidate to run all validation checks (struct validation,
// duplicate key detection, unknown key detection, typed-block validation),
// ensuring the web app enforces the same rules as the CLI.
func ValidateManifest(yamlPath string) ([]result.SAWError, error) {
	res := protocol.FullValidate(yamlPath, protocol.FullValidateOpts{})
	if res.IsFatal() {
		return nil, fmt.Errorf("failed to validate manifest: %s", res.Errors[0].Message)
	}
	data := res.GetData()
	if data.Valid {
		return nil, nil
	}
	return data.Errors, nil
}

// GetManifestWave returns a specific wave from a manifest.
// Returns an error if the wave number is invalid or if the file cannot be loaded.
func GetManifestWave(yamlPath string, waveNum int) (*protocol.Wave, error) {
	manifest, err := protocol.Load(yamlPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load manifest: %w", err)
	}

	if waveNum < 1 || waveNum > len(manifest.Waves) {
		return nil, fmt.Errorf("invalid wave number %d (manifest has %d waves)", waveNum, len(manifest.Waves))
	}

	// Wave numbers are 1-based in the protocol, but 0-based in the slice
	wave := &manifest.Waves[waveNum-1]
	return wave, nil
}

// SetManifestCompletion registers a completion report for an agent and saves the manifest.
// Returns an error if the agent ID is not found, if the manifest cannot be loaded,
// or if the manifest cannot be saved after updating.
func SetManifestCompletion(yamlPath, agentID string, report protocol.CompletionReport) error {
	manifest, err := protocol.Load(yamlPath)
	if err != nil {
		return fmt.Errorf("failed to load manifest: %w", err)
	}

	if err := protocol.SetCompletionReport(manifest, agentID, report); err != nil {
		return fmt.Errorf("failed to set completion report: %w", err)
	}

	if err := protocol.Save(manifest, yamlPath); err != nil {
		return fmt.Errorf("failed to save manifest: %w", err)
	}

	return nil
}
