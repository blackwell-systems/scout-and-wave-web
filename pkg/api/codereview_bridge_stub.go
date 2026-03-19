//go:build !codereview

// Package api — codereview_bridge_stub.go
//
// Stub implementation of runCodeReviewStep used when the "codereview" build
// tag is NOT set (i.e. before pkg/codereview is available in scout-and-wave-go).
//
// This stub skips the code review step gracefully so the rest of the pipeline
// continues to work. The integration wave (Agent E) should replace this with
// the real implementation by removing the build tags from codereview_bridge.go
// and deleting this file once pkg/codereview is merged.
package api

import "context"

// runCodeReviewStep is a no-op stub that skips code review when the
// codereview package is not yet available. It marks the step as skipped.
func runCodeReviewStep(
	ctx context.Context,
	slug string,
	waveNum int,
	repoPath string,
	tracker *pipelineTracker,
	publish func(string, interface{}),
) error {
	_ = ctx
	_ = repoPath
	_ = tracker.Skip(slug, waveNum, StepCodeReview)
	publishPipelineStep(publish, slug, waveNum, StepCodeReview, StepSkipped,
		"code review not available (pending dependency merge)")
	return nil
}
