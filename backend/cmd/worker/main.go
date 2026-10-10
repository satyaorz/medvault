// Command medvault-worker consumes document-processing jobs from Redis and
// runs the OCR → classify → extract → validate pipeline.
package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"time"

	"github.com/hibiken/asynq"

	"medvault/internal/aiclient"
	"medvault/internal/config"
	"medvault/internal/db"
	"medvault/internal/pipeline"
	"medvault/internal/queue"
	"medvault/internal/storage"
	"medvault/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(log)
	if err := run(log); err != nil {
		log.Error("worker stopped", "error", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx := context.Background()

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

	proc := &pipeline.Processor{
		Store: store.New(pool),
		Files: files,
		AI:    aiclient.New(cfg.AIServiceURL),
		Log:   log,
	}

	srv := asynq.NewServer(asynq.RedisClientOpt{Addr: cfg.RedisAddr}, asynq.Config{
		Concurrency: cfg.WorkerConcurrency,
		Logger:      asynqLogger{log},
		// Back off 10s, 40s, 90s… so a briefly unavailable AI service can recover.
		RetryDelayFunc: func(n int, _ error, _ *asynq.Task) time.Duration {
			return time.Duration(10*(n+1)*(n+1)) * time.Second
		},
		ShutdownTimeout: 30 * time.Second,
	})

	mux := asynq.NewServeMux()
	mux.HandleFunc(queue.TypeProcessDocument, func(ctx context.Context, t *asynq.Task) error {
		p, err := queue.ParseProcessDocument(t)
		if err != nil {
			return err
		}
		err = proc.Process(ctx, p.DocumentID)
		if err == nil {
			return nil
		}
		retried, _ := asynq.GetRetryCount(ctx)
		maxRetry, _ := asynq.GetMaxRetry(ctx)
		permanent := errors.Is(err, pipeline.ErrPermanent)
		log.Warn("processing attempt failed", "document_id", p.DocumentID, "attempt", retried+1,
			"permanent", permanent, "error", err)
		if permanent || retried >= maxRetry {
			proc.Fail(context.WithoutCancel(ctx), p.DocumentID, err)
			return errors.Join(err, asynq.SkipRetry)
		}
		proc.Retrying(context.WithoutCancel(ctx), p.DocumentID, retried+1, err)
		return err
	})

	log.Info("worker started", "concurrency", cfg.WorkerConcurrency, "ai_service", cfg.AIServiceURL)
	return srv.Run(mux) // handles SIGINT/SIGTERM gracefully
}

// asynqLogger routes Asynq's internal logs through slog.
type asynqLogger struct{ l *slog.Logger }

func (a asynqLogger) Debug(args ...any) {}
func (a asynqLogger) Info(args ...any)  { a.l.Info("asynq", "msg", args) }
func (a asynqLogger) Warn(args ...any)  { a.l.Warn("asynq", "msg", args) }
func (a asynqLogger) Error(args ...any) { a.l.Error("asynq", "msg", args) }
func (a asynqLogger) Fatal(args ...any) { a.l.Error("asynq fatal", "msg", args); os.Exit(1) }
