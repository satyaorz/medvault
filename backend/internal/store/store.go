// Package store is the PostgreSQL data-access layer. Every method that takes a
// userID enforces ownership in SQL, so a resource belonging to someone else is
// indistinguishable from one that does not exist (ErrNotFound).
package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
)

type Store struct {
	pool *pgxpool.Pool
	// Today is injectable for tests (medication course end, upcoming follow-ups).
	Today func() time.Time
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool, Today: func() time.Time {
		y, m, d := time.Now().Date()
		return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	}}
}

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

func (s *Store) withTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after commit
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// effDate is a document's effective date: its own date, else upload day.
const effDate = `COALESCE(d.doc_date, d.created_at::date)`
