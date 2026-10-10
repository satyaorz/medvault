// Package api is the public REST API (docs/CONTRACTS.md §3).
package api

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"medvault/internal/auth"
	"medvault/internal/queue"
	"medvault/internal/store"
)

// Files is the object storage the API needs.
type Files interface {
	Put(ctx context.Context, key, contentType string, data []byte) error
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
	Ping(ctx context.Context) error
}

// HealthCheck is a named dependency probe for GET /api/health.
type HealthCheck struct {
	Name     string
	Check    func(context.Context) error
	Optional bool // failure reports "unavailable" but keeps overall status ok
}

type Server struct {
	Store          *store.Store
	Files          Files
	Queue          queue.Enqueuer
	Tokens         *auth.Tokens
	Log            *slog.Logger
	CookieSecure   bool
	MaxUploadBytes int64
	Health         []HealthCheck

	authLimiter *rateLimiter
}

const sessionCookie = "mv_session"

func (s *Server) Routes() http.Handler {
	s.authLimiter = newRateLimiter(10, time.Minute)

	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, s.logRequests, middleware.Recoverer, securityHeaders)

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", s.health)

		r.Route("/auth", func(r chi.Router) {
			r.With(s.rateLimit).Post("/register", s.register)
			r.With(s.rateLimit).Post("/login", s.login)
			r.Post("/logout", s.logout)
			r.With(s.requireAuth).Get("/me", s.me)
		})

		r.Group(func(r chi.Router) {
			r.Use(s.requireAuth)

			r.Get("/profiles", s.listProfiles)
			r.Post("/profiles", s.createProfile)
			r.Route("/profiles/{profileID}", func(r chi.Router) {
				r.Use(validUUIDParam("profileID"))
				r.Get("/", s.getProfile)
				r.Patch("/", s.updateProfile)
				r.Delete("/", s.deleteProfile)
				r.Get("/summary", s.summary)
				r.Post("/documents", s.uploadDocument)
				r.Get("/documents", s.listDocuments)
				r.Get("/review", s.reviewQueue)
				r.Get("/timeline", s.timeline)
				r.Get("/labs", s.labs)
				r.Get("/labs/{code}", s.labSeries)
				r.Get("/medications", s.medications)
			})

			r.Route("/documents/{documentID}", func(r chi.Router) {
				r.Use(validUUIDParam("documentID"))
				r.Get("/", s.getDocument)
				r.Patch("/", s.updateDocument)
				r.Delete("/", s.deleteDocument)
				r.Get("/file", s.documentFile)
				r.Post("/reprocess", s.reprocessDocument)
				r.Get("/items", s.documentItems)
			})

			r.With(validUUIDParam("itemID")).Patch("/items/{itemID}", s.reviewItem)
		})

		r.NotFound(func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusNotFound, "not_found", "route not found")
		})
		r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusMethodNotAllowed, "bad_request", "method not allowed")
		})
	})
	return r
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	out := map[string]string{"status": "ok"}
	code := http.StatusOK
	for _, h := range s.Health {
		if err := h.Check(ctx); err != nil {
			if h.Optional {
				out[h.Name] = "unavailable"
				continue
			}
			out[h.Name], out["status"], code = "error", "degraded", http.StatusServiceUnavailable
			continue
		}
		out[h.Name] = "ok"
	}
	writeJSON(w, code, out)
}
