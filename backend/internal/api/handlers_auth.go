package api

import (
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"medvault/internal/auth"
	"medvault/internal/store"
)

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Email, in.Name = strings.TrimSpace(in.Email), strings.TrimSpace(in.Name)
	fields := map[string]string{}
	if a, err := mail.ParseAddress(in.Email); err != nil || a.Address != in.Email || len(in.Email) > 254 {
		fields["email"] = "enter a valid email address"
	}
	if len(in.Password) < 8 {
		fields["password"] = "must be at least 8 characters"
	} else if len(in.Password) > auth.MaxPasswordBytes {
		fields["password"] = "must be at most 72 bytes"
	}
	if in.Name == "" || len(in.Name) > 100 {
		fields["name"] = "enter your name (max 100 characters)"
	}
	if len(fields) > 0 {
		writeValidation(w, fields)
		return
	}

	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		s.writeStoreError(w, r, err, "user")
		return
	}
	u, err := s.Store.CreateUser(r.Context(), in.Email, in.Name, hash)
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "conflict", "an account with this email already exists")
		return
	}
	if err != nil {
		s.writeStoreError(w, r, err, "user")
		return
	}
	if !s.startSession(w, r, u.ID) {
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": u})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if !decodeJSON(w, r, &in) {
		return
	}
	u, hash, err := s.Store.UserByEmail(r.Context(), strings.TrimSpace(in.Email))
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		s.writeStoreError(w, r, err, "user")
		return
	}
	// CheckPassword with an empty hash burns the same time for unknown emails.
	if !auth.CheckPassword(hash, in.Password) || u == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "incorrect email or password")
		return
	}
	if !s.startSession(w, r, u.ID) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.CookieSecure, SameSite: http.SameSiteLaxMode,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	u, err := s.Store.UserByID(r.Context(), userID(r))
	if errors.Is(err, store.ErrNotFound) {
		// Valid token for a deleted account.
		writeError(w, http.StatusUnauthorized, "unauthorized", "please log in")
		return
	}
	if err != nil {
		s.writeStoreError(w, r, err, "user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, uid string) bool {
	token, err := s.Tokens.Issue(uid)
	if err != nil {
		s.writeStoreError(w, r, err, "session")
		return false
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/",
		Expires: time.Now().Add(s.Tokens.TTL()), MaxAge: int(s.Tokens.TTL().Seconds()),
		HttpOnly: true, Secure: s.CookieSecure, SameSite: http.SameSiteLaxMode,
	})
	return true
}
