package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"medvault/internal/store"
)

type apiError struct {
	Code       string            `json:"code"`
	Message    string            `json:"message"`
	Fields     map[string]string `json:"fields,omitempty"`
	ExistingID string            `json:"existing_id,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]apiError{"error": {Code: code, Message: msg}})
}

func writeValidation(w http.ResponseWriter, fields map[string]string) {
	writeJSON(w, http.StatusUnprocessableEntity, map[string]apiError{"error": {
		Code: "validation_failed", Message: "some fields are invalid", Fields: fields,
	}})
}

// writeStoreError maps data-layer errors to HTTP responses.
func (s *Server) writeStoreError(w http.ResponseWriter, r *http.Request, err error, what string) {
	var ve *store.ValidationError
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", what+" not found")
	case errors.As(err, &ve):
		writeValidation(w, ve.Problems)
	default:
		s.Log.Error("internal error", "error", err, "path", r.URL.Path, "request_id", requestID(r))
		writeError(w, http.StatusInternalServerError, "internal", "something went wrong")
	}
}

// decodeJSON reads a small JSON body strictly (unknown fields rejected).
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if ct := r.Header.Get("Content-Type"); ct != "" && !strings.HasPrefix(ct, "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "expected application/json")
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		msg := "invalid JSON body"
		if errors.Is(err, io.EOF) {
			msg = "request body is empty"
		} else if strings.HasPrefix(err.Error(), "json: unknown field") {
			msg = err.Error()[len("json: "):]
		}
		writeError(w, http.StatusBadRequest, "bad_request", msg)
		return false
	}
	return true
}
