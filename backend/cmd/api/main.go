// Command medvault-api serves the public REST API.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hibiken/asynq"

	"medvault/internal/aiclient"
	"medvault/internal/api"
	"medvault/internal/auth"
	"medvault/internal/config"
	"medvault/internal/db"
	"medvault/internal/queue"
	"medvault/internal/storage"
	"medvault/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(log)
	if err := run(log); err != nil {
		log.Error("api stopped", "error", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}

	files, err := storage.New(cfg.S3Endpoint, cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3Bucket, cfg.S3UseSSL)
	if err != nil {
		return err
	}
	if err := files.EnsureBucket(ctx); err != nil {
		return err
	}

	redisOpt := asynq.RedisClientOpt{Addr: cfg.RedisAddr}
	client := asynq.NewClient(redisOpt)
	defer client.Close()
	inspector := asynq.NewInspector(redisOpt)
	defer inspector.Close()
	ai := aiclient.New(cfg.AIServiceURL)

	srv := &api.Server{
		Store:          store.New(pool),
		Files:          files,
		Queue:          queue.AsynqEnqueuer{Client: client},
		Tokens:         auth.NewTokens(cfg.JWTSecret, cfg.SessionTTL),
		Log:            log,
		CookieSecure:   cfg.CookieSecure,
		MaxUploadBytes: cfg.MaxUploadBytes,
		Health: []api.HealthCheck{
			{Name: "db", Check: pool.Ping},
			{Name: "redis", Check: func(context.Context) error { _, err := inspector.Queues(); return err }},
			{Name: "storage", Check: files.Ping},
			{Name: "ai", Check: ai.Health, Optional: true},
		},
	}

	httpSrv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute, // large uploads on slow links
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       2 * time.Minute,
	}
	errCh := make(chan error, 1)
	go func() {
		log.Info("api listening", "addr", httpSrv.Addr)
		errCh <- httpSrv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		log.Info("shutting down")
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return httpSrv.Shutdown(shutdownCtx)
}
