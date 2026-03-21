package api

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
)

// respondJSON encodes data as JSON and writes to w with the given status code.
// Sets Content-Type: application/json. Logs encoding errors.
func respondJSON(w http.ResponseWriter, code int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("respondJSON: encode error: %v", err)
	}
}

// respondError writes a JSON error response: {"error": msg}
// Sets Content-Type: application/json.
func respondError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(map[string]string{"error": msg}); err != nil {
		log.Printf("respondError: encode error: %v", err)
	}
}

// decodeJSON reads the request body (max 1MB), decodes into v.
// Returns a user-friendly error on failure (bad JSON, too large, empty body).
func decodeJSON(r *http.Request, v interface{}) error {
	const maxBytes = 1 << 20 // 1MB

	r.Body = http.MaxBytesReader(nil, r.Body, maxBytes)
	dec := json.NewDecoder(r.Body)

	if err := dec.Decode(v); err != nil {
		var syntaxErr *json.SyntaxError
		var unmarshalErr *json.UnmarshalTypeError

		switch {
		case errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF):
			return errors.New("request body is empty")
		case errors.As(err, &syntaxErr):
			return errors.New("invalid JSON: " + syntaxErr.Error())
		case errors.As(err, &unmarshalErr):
			return errors.New(err.Error())
		case strings.Contains(err.Error(), "http: request body too large"):
			return errors.New("request body too large (max 1MB)")
		default:
			return err
		}
	}

	return nil
}
