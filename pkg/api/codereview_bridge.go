//go:build codereview

// Package api — codereview_bridge.go
//
// This file is compiled only when the "codereview" build tag is set, which
// requires that github.com/blackwell-systems/scout-and-wave-go/pkg/codereview
// is available (i.e. after Agent A's branch is merged into scout-and-wave-go).
//
// The integration wave (Agent E) should:
//  1. Merge scout-and-wave-go Agent A branch so pkg/codereview exists.
//  2. Remove the //go:build codereview constraint from this file.
//  3. Delete codereview_bridge_stub.go.
//  4. Wire QualityConfig.CodeReview and AgentConfig.ReviewModel in types.go.
package api

import (
	"context"
	"fmt"
	"log"

	codereview "github.com/blackwell-systems/scout-and-wave-go/pkg/codereview"
	"github.com/blackwell-systems/scout-and-wave-go/pkg/config"
)

// runCodeReviewStep executes the AI code review gate as pipeline Step 7.5.
// It reads CodeReviewConfig from saw.config.json and calls codereview.RunCodeReview.
// Returns a non-nil error only when the review is configured as blocking AND fails.
func runCodeReviewStep(
	ctx context.Context,
	slug string,
	waveNum int,
	repoPath string,
	tracker *pipelineTracker,
	publish func(string, interface{}),
) error {
	var reviewCfg codereview.CodeReviewConfig
	if sawCfg := config.LoadOrDefault(repoPath); sawCfg != nil {
		cr := sawCfg.Quality.CodeReview
		reviewCfg = codereview.CodeReviewConfig{
			Enabled:   cr.Enabled,
			Blocking:  cr.Blocking,
			Model:     cr.Model,
			Threshold: cr.Threshold,
		}
		if reviewCfg.Model == "" {
			reviewCfg.Model = sawCfg.Agent.ReviewModel
		}
	}

	if !reviewCfg.Enabled {
		_ = tracker.Skip(slug, waveNum, StepCodeReview)
		publishPipelineStep(publish, slug, waveNum, StepCodeReview, StepSkipped, "code review disabled")
		return nil
	}

	reviewResult, reviewErr := codereview.RunCodeReview(ctx, repoPath, reviewCfg)
	if reviewErr != nil {
		log.Printf("runFinalizeSteps: code-review non-fatal error: %v", reviewErr)
		_ = tracker.Complete(slug, waveNum, StepCodeReview)
		publishPipelineStep(publish, slug, waveNum, StepCodeReview, StepComplete,
			fmt.Sprintf("non-fatal: %v", reviewErr))
		return nil
	}

	if reviewResult != nil {
		payload := map[string]interface{}{
			"slug":       slug,
			"wave":       waveNum,
			"dimensions": reviewResult.Dimensions,
			"overall":    reviewResult.Overall,
			"passed":     reviewResult.Passed,
			"summary":    reviewResult.Summary,
			"model":      reviewResult.Model,
			"diff_bytes": reviewResult.DiffBytes,
		}
		publish("code_review_result", payload)
		_ = tracker.Complete(slug, waveNum, StepCodeReview)
		if !reviewResult.Passed && reviewCfg.Blocking {
			publishPipelineStep(publish, slug, waveNum, StepCodeReview, StepFailed,
				fmt.Sprintf("review score %d below threshold %d", reviewResult.Overall, reviewCfg.Threshold))
			return fmt.Errorf("code review failed: overall score %d < threshold %d",
				reviewResult.Overall, reviewCfg.Threshold)
		}
		publishPipelineStep(publish, slug, waveNum, StepCodeReview, StepComplete, "")
	}

	return nil
}
