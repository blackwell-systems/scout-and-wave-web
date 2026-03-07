// Package protocol provides parsing and validation utilities for IMPL markdown documents.
// It depends only on pkg/types and the standard library.
package protocol

import (
	"errors"

	// Re-export the sentinel error so callers can use protocol.ErrReportNotFound
	// without importing this package's internals.
	_ "errors"
)

// ErrReportNotFound is returned by ParseCompletionReport when the requested
// agent's completion report section does not exist in the IMPL doc.
var ErrReportNotFound = errors.New("completion report not found")
