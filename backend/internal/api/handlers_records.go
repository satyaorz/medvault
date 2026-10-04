package api

import (
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"
)

func (s *Server) documentItems(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "documentID")
	// Ownership check first so an unknown document is a 404, not an empty list.
	if _, err := s.Store.GetDocument(r.Context(), userID(r), id, false); err != nil {
		s.writeStoreError(w, r, err, "document")
		return
	}
	items, err := s.Store.DocumentItems(r.Context(), userID(r), id)
	if err != nil {
		s.writeStoreError(w, r, err, "document")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) reviewQueue(w http.ResponseWriter, r *http.Request) {
	items, err := s.Store.ReviewQueue(r.Context(), userID(r), chi.URLParam(r, "profileID"))
	if err != nil {
		s.writeStoreError(w, r, err, "profile")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) reviewItem(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Action string          `json:"action"`
		Data   json.RawMessage `json:"data"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.Action != "accept" && in.Action != "reject" {
		writeValidation(w, map[string]string{"action": `must be "accept" or "reject"`})
		return
	}
	if string(in.Data) == "null" {
		in.Data = nil
	}
	it, err := s.Store.ReviewItem(r.Context(), userID(r), chi.URLParam(r, "itemID"), in.Action, in.Data)
	if err != nil {
		s.writeStoreError(w, r, err, "item")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": it})
}

func (s *Server) timeline(w http.ResponseWriter, r *http.Request) {
	events, err := s.Store.Timeline(r.Context(), userID(r), chi.URLParam(r, "profileID"))
	if err != nil {
		s.writeStoreError(w, r, err, "profile")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (s *Server) labs(w http.ResponseWriter, r *http.Request) {
	tests, err := s.Store.Labs(r.Context(), userID(r), chi.URLParam(r, "profileID"))
	if err != nil {
		s.writeStoreError(w, r, err, "profile")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tests": tests})
}

func (s *Server) labSeries(w http.ResponseWriter, r *http.Request) {
	// chi returns the raw segment when it contains escapes (e.g. "raw%3Ahgb").
	code, err := url.PathUnescape(chi.URLParam(r, "code"))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "lab test not found")
		return
	}
	series, err := s.Store.LabSeries(r.Context(), userID(r), chi.URLParam(r, "profileID"), code)
	if err != nil {
		s.writeStoreError(w, r, err, "lab test")
		return
	}
	writeJSON(w, http.StatusOK, series)
}

func (s *Server) medications(w http.ResponseWriter, r *http.Request) {
	meds, err := s.Store.Medications(r.Context(), userID(r), chi.URLParam(r, "profileID"))
	if err != nil {
		s.writeStoreError(w, r, err, "profile")
		return
	}
	writeJSON(w, http.StatusOK, meds)
}

func (s *Server) summary(w http.ResponseWriter, r *http.Request) {
	sum, err := s.Store.Summary(r.Context(), userID(r), chi.URLParam(r, "profileID"))
	if err != nil {
		s.writeStoreError(w, r, err, "profile")
		return
	}
	writeJSON(w, http.StatusOK, sum)
}
