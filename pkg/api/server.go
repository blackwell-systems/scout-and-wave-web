package api

import (
	"context"
	"fmt"
	"io/fs"
	"net/http"
	"sync"
	"time"
)

// Config holds server configuration for saw serve.
type Config struct {
	Addr     string // e.g. "localhost:7432"
	IMPLDir  string // directory to scan for IMPL docs (e.g. "docs/IMPL")
	RepoPath string // absolute path to the repository root
}

// Server is the HTTP server for the saw web UI.
type Server struct {
	cfg        Config
	mux        *http.ServeMux
	broker     *sseBroker // unexported; used by wave.go handlers
	activeRuns sync.Map   // slug -> struct{}; tracks in-progress wave runs
	scoutRuns  sync.Map   // runID -> struct{}; tracks in-progress scout runs
}

// New creates a Server with the given Config and registers all routes.
func New(cfg Config) *Server {
	s := &Server{
		cfg: cfg,
		mux: http.NewServeMux(),
		broker: &sseBroker{
			clients: make(map[string][]chan SSEEvent),
		},
	}

	s.mux.HandleFunc("GET /api/impl", s.handleListImpls)
	s.mux.HandleFunc("GET /api/impl/{slug}", s.handleGetImpl)
	s.mux.HandleFunc("POST /api/impl/{slug}/approve", s.handleApprove)
	s.mux.HandleFunc("POST /api/impl/{slug}/reject", s.handleReject)
	s.mux.HandleFunc("GET /api/wave/{slug}/events", s.handleWaveEvents)
	s.mux.HandleFunc("GET /api/git/{slug}/activity", s.handleGitActivity)
	s.mux.HandleFunc("POST /api/wave/{slug}/start", s.handleWaveStart)
	s.mux.HandleFunc("POST /api/scout/run", s.handleScoutRun)
	s.mux.HandleFunc("GET /api/scout/{runID}/events", s.handleScoutEvents)
	sub, err := fs.Sub(staticFiles, "dist")
	if err != nil {
		panic("saw: failed to sub embed.FS: " + err.Error())
	}
	s.mux.Handle("/", http.FileServer(http.FS(sub)))

	return s
}

// Start starts the HTTP server and blocks until ctx is cancelled or a fatal
// error occurs. Callers (cmd/saw/serve_cmd.go) pass a context that is
// cancelled on SIGINT.
func (s *Server) Start(ctx context.Context) error {
	srv := &http.Server{
		Addr:    s.cfg.Addr,
		Handler: s.mux,
	}

	errCh := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return fmt.Errorf("saw serve: %w", err)
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}
