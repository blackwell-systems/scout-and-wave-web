package api

import (
	"testing"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/protocol"
)

func TestConvertQualityGates(t *testing.T) {
	// Test nil input
	if result := convertQualityGates(nil); result != nil {
		t.Error("Expected nil result for nil input")
	}

	// Test valid input
	input := &protocol.QualityGates{
		Level: "standard",
		Gates: []protocol.QualityGate{
			{
				Type:        "build",
				Command:     "go build ./...",
				Required:    true,
				Description: "Full build",
			},
			{
				Type:        "test",
				Command:     "go test ./...",
				Required:    true,
				Description: "",
			},
		},
	}

	result := convertQualityGates(input)
	if result == nil {
		t.Fatal("Expected non-nil result")
	}
	if result.Level != "standard" {
		t.Errorf("Expected level 'standard', got %q", result.Level)
	}
	if len(result.Gates) != 2 {
		t.Fatalf("Expected 2 gates, got %d", len(result.Gates))
	}
	if result.Gates[0].Type != "build" {
		t.Errorf("Expected gate type 'build', got %q", result.Gates[0].Type)
	}
	if result.Gates[0].Command != "go build ./..." {
		t.Errorf("Expected command 'go build ./...', got %q", result.Gates[0].Command)
	}
	if !result.Gates[0].Required {
		t.Error("Expected Required to be true")
	}
	if result.Gates[0].Description != "Full build" {
		t.Errorf("Expected description 'Full build', got %q", result.Gates[0].Description)
	}
}

func TestConvertPostMergeChecklist(t *testing.T) {
	// Test nil input
	if result := convertPostMergeChecklist(nil); result != nil {
		t.Error("Expected nil result for nil input")
	}

	// Test valid input
	input := &protocol.PostMergeChecklist{
		Groups: []protocol.ChecklistGroup{
			{
				Title: "Build",
				Items: []protocol.ChecklistItem{
					{Description: "Full build", Command: "go build"},
					{Description: "Run tests", Command: "go test"},
				},
			},
			{
				Title: "Verification",
				Items: []protocol.ChecklistItem{
					{Description: "Check output", Command: ""},
				},
			},
		},
	}

	result := convertPostMergeChecklist(input)
	if result == nil {
		t.Fatal("Expected non-nil result")
	}
	if len(result.Groups) != 2 {
		t.Fatalf("Expected 2 groups, got %d", len(result.Groups))
	}
	if result.Groups[0].Title != "Build" {
		t.Errorf("Expected title 'Build', got %q", result.Groups[0].Title)
	}
	if len(result.Groups[0].Items) != 2 {
		t.Fatalf("Expected 2 items in first group, got %d", len(result.Groups[0].Items))
	}
	if result.Groups[0].Items[0].Description != "Full build" {
		t.Errorf("Expected description 'Full build', got %q", result.Groups[0].Items[0].Description)
	}
	if result.Groups[0].Items[0].Command != "go build" {
		t.Errorf("Expected command 'go build', got %q", result.Groups[0].Items[0].Command)
	}
	if result.Groups[1].Title != "Verification" {
		t.Errorf("Expected title 'Verification', got %q", result.Groups[1].Title)
	}
}

func TestConvertKnownIssues(t *testing.T) {
	// Test nil input
	result := convertKnownIssues(nil)
	if result == nil {
		t.Error("Expected non-nil empty slice for nil input")
	}
	if len(result) != 0 {
		t.Errorf("Expected empty slice for nil input, got %d items", len(result))
	}

	// Test empty slice
	result = convertKnownIssues([]protocol.KnownIssue{})
	if result == nil {
		t.Error("Expected non-nil empty slice for empty input")
	}
	if len(result) != 0 {
		t.Errorf("Expected empty slice for empty input, got %d items", len(result))
	}

	// Test valid input with Title field
	input := []protocol.KnownIssue{
		{
			Title:       "Race condition in parser",
			Description: "Parser may fail on concurrent access",
			Status:      "open",
			Workaround:  "Use mutex",
		},
		{
			Title:       "",
			Description: "Memory leak in cache",
			Status:      "investigating",
			Workaround:  "Restart service",
		},
	}

	result = convertKnownIssues(input)
	if result == nil {
		t.Fatal("Expected non-nil result")
	}
	if len(result) != 2 {
		t.Fatalf("Expected 2 issues, got %d", len(result))
	}
	if result[0].Title != "Race condition in parser" {
		t.Errorf("Expected title 'Race condition in parser', got %q", result[0].Title)
	}
	if result[0].Description != "Parser may fail on concurrent access" {
		t.Errorf("Expected description 'Parser may fail on concurrent access', got %q", result[0].Description)
	}
	if result[0].Status != "open" {
		t.Errorf("Expected status 'open', got %q", result[0].Status)
	}
	if result[0].Workaround != "Use mutex" {
		t.Errorf("Expected workaround 'Use mutex', got %q", result[0].Workaround)
	}
	if result[1].Title != "" {
		t.Errorf("Expected empty title, got %q", result[1].Title)
	}
}
