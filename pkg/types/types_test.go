package types

import "testing"

// TestStateString verifies every State constant returns the expected string from .String().
func TestStateString(t *testing.T) {
	cases := []struct {
		state    State
		expected string
	}{
		{ScoutPending, "ScoutPending"},
		{ScoutValidating, "ScoutValidating"},
		{NotSuitable, "NotSuitable"},
		{Reviewed, "Reviewed"},
		{ScaffoldPending, "ScaffoldPending"},
		{WavePending, "WavePending"},
		{WaveExecuting, "WaveExecuting"},
		{WaveMerging, "WaveMerging"},
		{WaveVerified, "WaveVerified"},
		{Blocked, "Blocked"},
		{Complete, "Complete"},
		{State(99), "Unknown"},
	}

	for _, tc := range cases {
		got := tc.state.String()
		if got != tc.expected {
			t.Errorf("State(%d).String() = %q; want %q", int(tc.state), got, tc.expected)
		}
	}
}

// TestStateOrdering verifies ScoutValidating sits between ScoutPending and NotSuitable.
func TestStateOrdering(t *testing.T) {
	if !(ScoutPending < ScoutValidating && ScoutValidating < NotSuitable) {
		t.Errorf("ScoutValidating must be between ScoutPending and NotSuitable")
	}
}

// TestPreMortemZeroValue verifies PreMortem{} has empty OverallRisk and nil Rows.
func TestPreMortemZeroValue(t *testing.T) {
	var pm PreMortem
	if pm.OverallRisk != "" {
		t.Errorf("PreMortem{}.OverallRisk = %q; want empty string", pm.OverallRisk)
	}
	if pm.Rows != nil {
		t.Errorf("PreMortem{}.Rows = %v; want nil", pm.Rows)
	}
}

// TestValidationErrorFields verifies ValidationError fields can be set and read back.
func TestValidationErrorFields(t *testing.T) {
	ve := ValidationError{
		BlockType:  "impl-wave-structure",
		LineNumber: 42,
		Message:    "missing required field",
	}

	if ve.BlockType != "impl-wave-structure" {
		t.Errorf("ValidationError.BlockType = %q; want %q", ve.BlockType, "impl-wave-structure")
	}
	if ve.LineNumber != 42 {
		t.Errorf("ValidationError.LineNumber = %d; want 42", ve.LineNumber)
	}
	if ve.Message != "missing required field" {
		t.Errorf("ValidationError.Message = %q; want %q", ve.Message, "missing required field")
	}
}

// TestIMPLDocPreMortemField verifies IMPLDoc has a PreMortem *PreMortem field.
func TestIMPLDocPreMortemField(t *testing.T) {
	pm := &PreMortem{
		OverallRisk: "medium",
		Rows: []PreMortemRow{
			{
				Scenario:   "parsing fails on malformed YAML",
				Likelihood: "low",
				Impact:     "high",
				Mitigation: "add error handling",
			},
		},
	}

	doc := IMPLDoc{
		PreMortem: pm,
	}

	if doc.PreMortem == nil {
		t.Fatal("IMPLDoc.PreMortem is nil; want non-nil")
	}
	if doc.PreMortem.OverallRisk != "medium" {
		t.Errorf("IMPLDoc.PreMortem.OverallRisk = %q; want %q", doc.PreMortem.OverallRisk, "medium")
	}
	if len(doc.PreMortem.Rows) != 1 {
		t.Errorf("IMPLDoc.PreMortem.Rows length = %d; want 1", len(doc.PreMortem.Rows))
	}
}
