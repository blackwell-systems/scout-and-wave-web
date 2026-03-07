//go:build integration

package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"

	"github.com/blackwell-systems/scout-and-wave-go/pkg/api"
)

// runServe parses flags and starts the local HTTP API server for reviewing IMPL docs.
// Flags:
//
//	--addr string       "localhost:7432"  Listen address
//	--impl-dir string   ""                IMPL doc directory (default: <repo>/docs/IMPL)
//	--repo string       ""                Repo root (default: auto-detect via findRepoRoot)
//	--no-browser bool   false             Skip opening the browser
func runServe(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	addr := fs.String("addr", "localhost:7432", "Listen address")
	implDir := fs.String("impl-dir", "", "IMPL doc directory (default: <repo>/docs/IMPL)")
	repoFlag := fs.String("repo", "", "Repo root (default: auto-detect from cwd)")
	noBrowser := fs.Bool("no-browser", false, "Skip opening the browser")

	if err := fs.Parse(args); err != nil {
		return fmt.Errorf("serve: %w", err)
	}

	// Resolve repoRoot.
	repoRoot := *repoFlag
	if repoRoot == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return fmt.Errorf("serve: cannot get cwd: %w", err)
		}
		repoRoot, err = findRepoRoot(cwd)
		if err != nil {
			return fmt.Errorf("serve: %w", err)
		}
	}

	// Resolve implDir.
	resolvedImplDir := *implDir
	if resolvedImplDir == "" {
		resolvedImplDir = filepath.Join(repoRoot, "docs", "IMPL")
	}

	cfg := api.Config{
		Addr:     *addr,
		IMPLDir:  resolvedImplDir,
		RepoPath: repoRoot,
	}

	s := api.New(cfg)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	if !*noBrowser {
		openBrowser("http://" + *addr)
	}

	fmt.Printf("saw serve: listening on http://%s\n", *addr)
	return s.Start(ctx)
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
