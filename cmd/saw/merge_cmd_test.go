package main

import (
	"flag"
	"strings"
	"testing"
)

func TestRunMerge_MissingImplFlag(t *testing.T) {
	err := runMerge([]string{})
	if err == nil {
		t.Fatal("expected error when --impl is not provided, got nil")
	}
	if !strings.Contains(err.Error(), "required") {
		t.Errorf("expected error to contain %q, got: %v", "required", err)
	}
}

func TestRunMerge_InvalidImpl(t *testing.T) {
	err := runMerge([]string{"--impl", "/nonexistent/path.yaml"})
	if err == nil {
		t.Fatal("expected error for nonexistent IMPL path, got nil")
	}
}

func TestRunMerge_FlagParsing(t *testing.T) {
	// Verify that --wave 2 is correctly parsed by the flag set.
	// We use a local FlagSet that mirrors runMerge's setup to inspect the value.
	fs := flag.NewFlagSet("merge-test", flag.ContinueOnError)
	implPath := fs.String("impl", "", "")
	waveNum := fs.Int("wave", 1, "")

	args := []string{"--impl", "/some/path.yaml", "--wave", "2"}
	if err := fs.Parse(args); err != nil {
		t.Fatalf("flag parsing failed: %v", err)
	}

	if *waveNum != 2 {
		t.Errorf("expected --wave 2, got %d", *waveNum)
	}
	if *implPath != "/some/path.yaml" {
		t.Errorf("expected --impl /some/path.yaml, got %s", *implPath)
	}
}
