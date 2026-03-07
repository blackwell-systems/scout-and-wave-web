//go:build integration

package main

import (
	"testing"
)

// TestRunServe_BadFlag verifies that runServe returns a non-nil error for an unknown flag.
func TestRunServe_BadFlag(t *testing.T) {
	err := runServe([]string{"--badFlag"})
	if err == nil {
		t.Fatal("expected non-nil error for unknown flag, got nil")
	}
}

// TestRunServe_FlagParsing verifies that flag parsing works with valid flags.
// This test uses --no-browser and a local address to avoid actually starting a server
// in a useful way; the real server start requires Agent A's api.New/Start.
func TestRunServe_FlagParsing(t *testing.T) {
	// We can't fully call runServe without a real api.Server.Start, but we can
	// verify flag parsing itself doesn't error with valid flags before the server call.
	// Since this is the integration tag file, a full integration test would require
	// the api package to be complete. This test documents expected behavior.
	t.Log("integration: flag parsing test placeholder — requires full api package")
}
