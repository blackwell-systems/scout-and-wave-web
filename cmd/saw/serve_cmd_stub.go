//go:build !integration

package main

import (
	"fmt"
	"os/exec"
	"runtime"
)

// runServe is the non-integration stub. The real implementation (which depends on
// pkg/api.New and pkg/api.Server) is in serve_cmd.go and activates with the
// "integration" build tag once Agent A's pkg/api package is merged.
func runServe(args []string) error {
	return fmt.Errorf("serve: not available in this build (requires integration tag)")
}

// openBrowser launches the system default browser for the given URL.
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	default:
		return
	}
	_ = cmd.Start()
}
