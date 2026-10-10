package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"medvault/internal/store"
)

var (
	relationships = map[string]bool{"self": true, "parent": true, "child": true, "spouse": true, "sibling": true, "grandparent": true, "other": true}
	sexes         = map[string]bool{"male": true, "female": true, "other": true}
)

func (s *Server) listProfiles(w http.ResponseWriter, r *http.Request) {
	ps, err := s.Store.ListProfiles(r.Context(), userID(r))
	if err != nil {
		s.writeStoreError(w, r, err, "profile")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profiles": ps})
}

func (s *Server) getProfile(w http.ResponseWriter, r *http.Request) {
	p, err := s.Store.GetProfile(r.Context(), userID(r), chi.URLParam(r, "profileID"))
	if err != nil {
		s.writeStoreError(w, r, err, "profile")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": p})
}

func (s *Server) createProfile(w http.ResponseWriter, r *http.Request) {
	var in store.ProfileInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if fields := validateProfile(&in, true); len(fields) > 0 {
		writeValidation(w, fields)
		return
	}
	p, err := s.Store.CreateProfile(r.Context(), userID(r), in)
	if err != nil {
		s.writeStoreError(w, r, err, "profile")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"profile": p})
}

func (s *Server) updateProfile(w http.ResponseWriter, r *http.Request) {
	// Read the body twice: once typed, once raw to see which keys are explicitly null.
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "could not read body")
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	var in store.ProfileInput
	if !decodeJSON(w, r, &in) {
		return
	}
	var raw map[string]json.RawMessage
	json.Unmarshal(body, &raw) //nolint:errcheck // already validated above
	isNull := func(k string) bool { v, ok := raw[k]; return ok && string(v) == "null" }

	if fields := validateProfile(&in, false); len(fields) > 0 {
		writeValidation(w, fields)
		return
	}
	p, err := s.Store.UpdateProfile(r.Context(), userID(r), chi.URLParam(r, "profileID"), in,
		isNull("date_of_birth"), isNull("sex"))
	if err != nil {
		s.writeStoreError(w, r, err, "profile")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": p})
}

func validateProfile(in *store.ProfileInput, create bool) map[string]string {
	fields := map[string]string{}
	if in.Name != nil {
		n := strings.TrimSpace(*in.Name)
		in.Name = &n
	}
	if (create || in.Name != nil) && (in.Name == nil || *in.Name == "" || len(*in.Name) > 100) {
		fields["name"] = "enter a name (max 100 characters)"
	}
	if create && in.Relationship == nil {
		fields["relationship"] = "is required"
	}
	if in.Relationship != nil && !relationships[*in.Relationship] {
		fields["relationship"] = "must be one of self, parent, child, spouse, sibling, grandparent, other"
	}
	if in.Sex != nil && !sexes[*in.Sex] {
		fields["sex"] = "must be male, female or other"
	}
	if in.DateOfBirth != nil {
		d, err := time.Parse(time.DateOnly, *in.DateOfBirth)
		if err != nil || d.After(time.Now()) || d.Year() < 1900 {
			fields["date_of_birth"] = "must be a past date in YYYY-MM-DD format"
		}
	}
	return fields
}

func (s *Server) deleteProfile(w http.ResponseWriter, r *http.Request) {
	keys, err := s.Store.DeleteProfile(r.Context(), userID(r), chi.URLParam(r, "profileID"))
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "conflict", "you cannot delete your only profile")
		return
	}
	if err != nil {
		s.writeStoreError(w, r, err, "profile")
		return
	}
	s.deleteObjects(r, keys...)
	w.WriteHeader(http.StatusNoContent)
}

// deleteObjects removes stored files after their rows are gone. Failures only
// leave orphaned blobs (no data exposure), so they are logged, not returned.
func (s *Server) deleteObjects(r *http.Request, keys ...string) {
	for _, k := range keys {
		if err := s.Files.Delete(r.Context(), k); err != nil {
			s.Log.Warn("could not delete stored object", "key", k, "error", err)
		}
	}
}
