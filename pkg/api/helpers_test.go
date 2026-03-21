package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestHelpersRespondJSON verifies respondJSON writes correct status, Content-Type, and body.
func TestHelpersRespondJSON(t *testing.T) {
	t.Run("200 with struct", func(t *testing.T) {
		type payload struct {
			Name string `json:"name"`
		}
		w := httptest.NewRecorder()
		respondJSON(w, http.StatusOK, payload{Name: "alice"})

		if w.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
		}
		if ct := w.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q, want application/json", ct)
		}
		var got payload
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if got.Name != "alice" {
			t.Errorf("Name = %q, want alice", got.Name)
		}
	})

	t.Run("201 with slice", func(t *testing.T) {
		w := httptest.NewRecorder()
		respondJSON(w, http.StatusCreated, []string{"a", "b"})

		if w.Code != http.StatusCreated {
			t.Errorf("status = %d, want %d", w.Code, http.StatusCreated)
		}
		var got []string
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if len(got) != 2 || got[0] != "a" || got[1] != "b" {
			t.Errorf("got %v, want [a b]", got)
		}
	})

	t.Run("nil data", func(t *testing.T) {
		w := httptest.NewRecorder()
		respondJSON(w, http.StatusOK, nil)

		if w.Code != http.StatusOK {
			t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
		}
		// nil encodes to "null\n" — verify it's valid JSON
		body := strings.TrimSpace(w.Body.String())
		if body != "null" {
			t.Errorf("body = %q, want null", body)
		}
	})
}

// TestHelpersRespondError verifies respondError sends {"error": "..."} JSON bodies.
func TestHelpersRespondError(t *testing.T) {
	t.Run("400 with message", func(t *testing.T) {
		w := httptest.NewRecorder()
		respondError(w, "bad request", http.StatusBadRequest)

		if w.Code != http.StatusBadRequest {
			t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
		}
		if ct := w.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q, want application/json", ct)
		}
		var got map[string]string
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if got["error"] != "bad request" {
			t.Errorf("error = %q, want bad request", got["error"])
		}
	})

	t.Run("500 with message", func(t *testing.T) {
		w := httptest.NewRecorder()
		respondError(w, "internal error", http.StatusInternalServerError)

		if w.Code != http.StatusInternalServerError {
			t.Errorf("status = %d, want %d", w.Code, http.StatusInternalServerError)
		}
		var got map[string]string
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if got["error"] != "internal error" {
			t.Errorf("error = %q, want internal error", got["error"])
		}
	})

	t.Run("JSON structure has only error key", func(t *testing.T) {
		w := httptest.NewRecorder()
		respondError(w, "something went wrong", http.StatusUnprocessableEntity)

		var got map[string]interface{}
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		if _, ok := got["error"]; !ok {
			t.Error("response JSON missing 'error' key")
		}
		if len(got) != 1 {
			t.Errorf("expected exactly 1 key, got %d: %v", len(got), got)
		}
	})
}

// TestHelpersDecodeJSON verifies decodeJSON handles various input conditions.
func TestHelpersDecodeJSON(t *testing.T) {
	type sample struct {
		Name string `json:"name"`
		Age  int    `json:"age"`
	}

	t.Run("valid JSON struct", func(t *testing.T) {
		body := `{"name":"bob","age":30}`
		r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")

		var got sample
		if err := decodeJSON(r, &got); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got.Name != "bob" || got.Age != 30 {
			t.Errorf("got %+v, want {bob 30}", got)
		}
	})

	t.Run("empty body returns user-friendly error", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(""))
		r.Header.Set("Content-Type", "application/json")

		var got sample
		err := decodeJSON(r, &got)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
		if err.Error() != "request body is empty" {
			t.Errorf("error = %q, want 'request body is empty'", err.Error())
		}
	})

	t.Run("malformed JSON returns user-friendly error", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("{bad json"))
		r.Header.Set("Content-Type", "application/json")

		var got sample
		err := decodeJSON(r, &got)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
		if !strings.HasPrefix(err.Error(), "invalid JSON:") {
			t.Errorf("error = %q, want prefix 'invalid JSON:'", err.Error())
		}
	})

	t.Run("body exceeding 1MB returns too-large error", func(t *testing.T) {
		// Build a JSON object that exceeds 1MB
		bigValue := strings.Repeat("x", 1<<20+1) // 1MB + 1 byte
		body := `{"name":"` + bigValue + `"}`
		r := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")

		var got sample
		err := decodeJSON(r, &got)
		if err == nil {
			t.Fatal("expected error for oversized body, got nil")
		}
		if err.Error() != "request body too large (max 1MB)" {
			t.Errorf("error = %q, want 'request body too large (max 1MB)'", err.Error())
		}
	})
}
