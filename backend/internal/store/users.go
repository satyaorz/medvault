package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type User struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

// CreateUser inserts the user together with their own "self" profile.
// Returns ErrConflict if the email is taken (case-insensitive).
func (s *Store) CreateUser(ctx context.Context, email, name, passwordHash string) (*User, error) {
	var u User
	err := s.withTx(ctx, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)
			RETURNING id::text, email, name, created_at`, email, passwordHash, name,
		).Scan(&u.ID, &u.Email, &u.Name, &u.CreatedAt)
		if err != nil {
			if isUniqueViolation(err) {
				return ErrConflict
			}
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO profiles (user_id, name, relationship) VALUES ($1, $2, 'self')`, u.ID, name)
		return err
	})
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// UserByEmail returns the user and their password hash.
func (s *Store) UserByEmail(ctx context.Context, email string) (*User, string, error) {
	var u User
	var hash string
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, email, name, created_at, password_hash FROM users WHERE lower(email) = lower($1)`, email,
	).Scan(&u.ID, &u.Email, &u.Name, &u.CreatedAt, &hash)
	if err != nil {
		return nil, "", notFound(err)
	}
	return &u, hash, nil
}

func (s *Store) UserByID(ctx context.Context, id string) (*User, error) {
	var u User
	err := s.pool.QueryRow(ctx, `SELECT id::text, email, name, created_at FROM users WHERE id = $1`, id).
		Scan(&u.ID, &u.Email, &u.Name, &u.CreatedAt)
	if err != nil {
		return nil, notFound(err)
	}
	return &u, nil
}
