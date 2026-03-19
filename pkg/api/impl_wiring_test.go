package api

import (
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

// TestWiringPopulation verifies that implDocResponseFromManifest correctly
// converts WiringDeclaration entries from the manifest into WiringEntry values
// in the response.
func TestWiringPopulation(t *testing.T) {
	manifest := &protocol.IMPLManifest{
		Title:       "Test Feature",
		FeatureSlug: "test-feature",
		Verdict:     "SUITABLE",
		Wiring: []protocol.WiringDeclaration{
			{
				Symbol:             "CheckWiringOwnership",
				DefinedIn:          "pkg/protocol/wiring.go",
				MustBeCalledFrom:   "cmd/saw/prepare_wave.go",
				Agent:              "C",
				Wave:               2,
				IntegrationPattern: "pre-flight check",
			},
			{
				Symbol:           "ValidateWiringDeclarations",
				DefinedIn:        "pkg/protocol/wiring_validation.go",
				MustBeCalledFrom: "cmd/saw/finalize_wave.go",
				Agent:            "D",
				Wave:             2,
			},
		},
	}

	resp := implDocResponseFromManifest("test-feature", manifest)

	if len(resp.Wiring) != 2 {
		t.Fatalf("expected 2 wiring entries, got %d", len(resp.Wiring))
	}

	// Verify first entry
	e0 := resp.Wiring[0]
	if e0.Symbol != "CheckWiringOwnership" {
		t.Errorf("entry[0].Symbol: expected %q, got %q", "CheckWiringOwnership", e0.Symbol)
	}
	if e0.DefinedIn != "pkg/protocol/wiring.go" {
		t.Errorf("entry[0].DefinedIn: expected %q, got %q", "pkg/protocol/wiring.go", e0.DefinedIn)
	}
	if e0.MustBeCalledFrom != "cmd/saw/prepare_wave.go" {
		t.Errorf("entry[0].MustBeCalledFrom: expected %q, got %q", "cmd/saw/prepare_wave.go", e0.MustBeCalledFrom)
	}
	if e0.Agent != "C" {
		t.Errorf("entry[0].Agent: expected %q, got %q", "C", e0.Agent)
	}
	if e0.Wave != 2 {
		t.Errorf("entry[0].Wave: expected %d, got %d", 2, e0.Wave)
	}
	if e0.IntegrationPattern != "pre-flight check" {
		t.Errorf("entry[0].IntegrationPattern: expected %q, got %q", "pre-flight check", e0.IntegrationPattern)
	}
	if e0.Status != "declared" {
		t.Errorf("entry[0].Status: expected %q, got %q", "declared", e0.Status)
	}

	// Verify second entry
	e1 := resp.Wiring[1]
	if e1.Symbol != "ValidateWiringDeclarations" {
		t.Errorf("entry[1].Symbol: expected %q, got %q", "ValidateWiringDeclarations", e1.Symbol)
	}
	if e1.DefinedIn != "pkg/protocol/wiring_validation.go" {
		t.Errorf("entry[1].DefinedIn: expected %q, got %q", "pkg/protocol/wiring_validation.go", e1.DefinedIn)
	}
	if e1.MustBeCalledFrom != "cmd/saw/finalize_wave.go" {
		t.Errorf("entry[1].MustBeCalledFrom: expected %q, got %q", "cmd/saw/finalize_wave.go", e1.MustBeCalledFrom)
	}
	if e1.Status != "declared" {
		t.Errorf("entry[1].Status: expected %q, got %q", "declared", e1.Status)
	}
	if e1.IntegrationPattern != "" {
		t.Errorf("entry[1].IntegrationPattern: expected empty, got %q", e1.IntegrationPattern)
	}
}

// TestWiringPopulation_EmptyManifest verifies that a manifest with no wiring
// entries produces an empty (non-nil) slice in the response.
func TestWiringPopulation_EmptyManifest(t *testing.T) {
	manifest := &protocol.IMPLManifest{
		Title:       "No Wiring Feature",
		FeatureSlug: "no-wiring",
		Verdict:     "SUITABLE",
	}

	resp := implDocResponseFromManifest("no-wiring", manifest)

	if resp.Wiring == nil {
		t.Fatal("expected non-nil Wiring slice, got nil")
	}
	if len(resp.Wiring) != 0 {
		t.Errorf("expected empty Wiring slice, got %d entries", len(resp.Wiring))
	}
}
