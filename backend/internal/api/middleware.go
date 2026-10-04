package api

import (
	"context"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"golang.org/x/time/rate"
)

type ctxKey int

const userIDKey ctxKey = iota

func userID(r *http.Request) string {
	id, _ := r.Context().Value(userIDKey).(string)
	return id
}

func requestID(r *http.Request) string { return middleware.GetReqID(r.Context()) }

// requireAuth accepts the session cookie or an "Authorization: Bearer" token.
func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := ""
		if c, err := r.Cookie(sessionCookie); err == nil {
			token = c.Value
		}
		if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			token = strings.TrimPrefix(h, "Bearer ")
		}
		id, err := s.Tokens.Verify(token)
		if token == "" || err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "please log in")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userIDKey, id)))
	})
}

// validUUIDParam turns malformed IDs into 404s before they reach SQL.
func validUUIDParam(name string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, err := uuid.Parse(chi.URLParam(r, name)); err != nil {
				writeError(w, http.StatusNotFound, "not_found", "resource not found")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Cache-Control", "no-store") // medical data must not sit in shared caches
		next.ServeHTTP(w, r)
	})
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		// Paths contain only IDs, never medical content, so they are safe to log.
		s.Log.Info("request", "method", r.Method, "path", r.URL.Path, "status", ww.Status(),
			"duration_ms", time.Since(start).Milliseconds(), "request_id", requestID(r))
	})
}

// rateLimiter is a per-IP token bucket for the login/register endpoints.
type rateLimiter struct {
	mu      sync.Mutex
	perIP   map[string]*visitor
	limit   rate.Limit
	burst   int
	lastGC  time.Time
	idleTTL time.Duration
}

type visitor struct {
	lim  *rate.Limiter
	seen time.Time
}

func newRateLimiter(n int, per time.Duration) *rateLimiter {
	return &rateLimiter{perIP: map[string]*visitor{}, limit: rate.Every(per / time.Duration(n)), burst: n, idleTTL: 10 * time.Minute}
}

func (l *rateLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if now.Sub(l.lastGC) > time.Minute {
		for k, v := range l.perIP {
			if now.Sub(v.seen) > l.idleTTL {
				delete(l.perIP, k)
			}
		}
		l.lastGC = now
	}
	v, ok := l.perIP[ip]
	if !ok {
		v = &visitor{lim: rate.NewLimiter(l.limit, l.burst)}
		l.perIP[ip] = v
	}
	v.seen = now
	return v.lim.Allow()
}

func (s *Server) rateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			ip = r.RemoteAddr
		}
		if !s.authLimiter.allow(ip) {
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "rate_limited", "too many attempts, try again in a minute")
			return
		}
		next.ServeHTTP(w, r)
	})
}
