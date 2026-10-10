// Package config loads runtime configuration from environment variables.
// Defaults target local development (infra from docker-compose on localhost).
package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port              string
	DatabaseURL       string
	RedisAddr         string
	S3Endpoint        string
	S3AccessKey       string
	S3SecretKey       string
	S3Bucket          string
	S3UseSSL          bool
	AIServiceURL      string
	JWTSecret         []byte
	SessionTTL        time.Duration
	CookieSecure      bool
	MaxUploadBytes    int64
	WorkerConcurrency int
}

const devJWTSecret = "medvault-dev-secret-do-not-use-in-production"

func Load() (Config, error) {
	c := Config{
		Port:              env("PORT", "8080"),
		DatabaseURL:       env("DATABASE_URL", "postgres://medvault:medvault@localhost:5432/medvault?sslmode=disable"),
		RedisAddr:         env("REDIS_ADDR", "localhost:6379"),
		S3Endpoint:        env("S3_ENDPOINT", "localhost:8333"),
		S3AccessKey:       env("S3_ACCESS_KEY", "medvault"),
		S3SecretKey:       env("S3_SECRET_KEY", "medvault-secret"),
		S3Bucket:          env("S3_BUCKET", "medvault-documents"),
		S3UseSSL:          envBool("S3_USE_SSL", false),
		AIServiceURL:      env("AI_SERVICE_URL", "http://localhost:8000"),
		JWTSecret:         []byte(env("JWT_SECRET", devJWTSecret)),
		SessionTTL:        7 * 24 * time.Hour,
		CookieSecure:      envBool("COOKIE_SECURE", false),
		MaxUploadBytes:    int64(envInt("MAX_UPLOAD_MB", 20)) << 20,
		WorkerConcurrency: envInt("WORKER_CONCURRENCY", 2),
	}
	if string(c.JWTSecret) == devJWTSecret {
		slog.Warn("JWT_SECRET not set — using the insecure development secret")
	}
	if len(c.JWTSecret) < 32 {
		return c, fmt.Errorf("JWT_SECRET must be at least 32 bytes")
	}
	return c, nil
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	v, err := strconv.ParseBool(os.Getenv(key))
	if err != nil {
		return def
	}
	return v
}

func envInt(key string, def int) int {
	v, err := strconv.Atoi(os.Getenv(key))
	if err != nil || v <= 0 {
		return def
	}
	return v
}
