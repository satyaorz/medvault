package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

type Profile struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Relationship  string    `json:"relationship"`
	DateOfBirth   *string   `json:"date_of_birth"`
	Sex           *string   `json:"sex"`
	CreatedAt     time.Time `json:"created_at"`
	DocumentCount int       `json:"document_count"`
}

type ProfileInput struct {
	Name         *string `json:"name"`
	Relationship *string `json:"relationship"`
	DateOfBirth  *string `json:"date_of_birth"`
	Sex          *string `json:"sex"`
}

const profileCols = `p.id::text, p.name, p.relationship, to_char(p.date_of_birth, 'YYYY-MM-DD'), p.sex, p.created_at,
	(SELECT count(*) FROM documents d WHERE d.profile_id = p.id)`

func scanProfile(row pgx.Row) (*Profile, error) {
	var p Profile
	err := row.Scan(&p.ID, &p.Name, &p.Relationship, &p.DateOfBirth, &p.Sex, &p.CreatedAt, &p.DocumentCount)
	if err != nil {
		return nil, notFound(err)
	}
	return &p, nil
}

func (s *Store) ListProfiles(ctx context.Context, userID string) ([]Profile, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+profileCols+` FROM profiles p WHERE p.user_id = $1
		ORDER BY (p.relationship = 'self') DESC, p.created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Profile{}
	for rows.Next() {
		p, err := scanProfile(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func (s *Store) GetProfile(ctx context.Context, userID, profileID string) (*Profile, error) {
	return scanProfile(s.pool.QueryRow(ctx, `SELECT `+profileCols+` FROM profiles p WHERE p.id = $1 AND p.user_id = $2`, profileID, userID))
}

// CheckProfile verifies ownership without loading the profile.
func (s *Store) CheckProfile(ctx context.Context, userID, profileID string) error {
	var ok bool
	err := s.pool.QueryRow(ctx, `SELECT true FROM profiles WHERE id = $1 AND user_id = $2`, profileID, userID).Scan(&ok)
	return notFound(err)
}

// CreateProfile expects in.Name and in.Relationship to be set (validated by the caller).
func (s *Store) CreateProfile(ctx context.Context, userID string, in ProfileInput) (*Profile, error) {
	var id string
	err := s.pool.QueryRow(ctx, `INSERT INTO profiles (user_id, name, relationship, date_of_birth, sex)
		VALUES ($1, $2, $3, $4::date, $5) RETURNING id::text`,
		userID, in.Name, in.Relationship, in.DateOfBirth, in.Sex).Scan(&id)
	if err != nil {
		return nil, err
	}
	return s.GetProfile(ctx, userID, id)
}

// UpdateProfile applies only the fields present in the input.
// clearDOB / clearSex distinguish "set to null" from "not provided".
func (s *Store) UpdateProfile(ctx context.Context, userID, profileID string, in ProfileInput, clearDOB, clearSex bool) (*Profile, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE profiles SET
			name = COALESCE($3, name),
			relationship = COALESCE($4, relationship),
			date_of_birth = CASE WHEN $7 THEN NULL ELSE COALESCE($5::date, date_of_birth) END,
			sex = CASE WHEN $8 THEN NULL ELSE COALESCE($6, sex) END
		WHERE id = $1 AND user_id = $2`,
		profileID, userID, in.Name, in.Relationship, in.DateOfBirth, in.Sex, clearDOB, clearSex)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.GetProfile(ctx, userID, profileID)
}

// DeleteProfile removes the profile (cascading to documents and the record)
// and returns the storage keys whose objects the caller should delete.
// Refuses (ErrConflict) to delete the user's last profile.
func (s *Store) DeleteProfile(ctx context.Context, userID, profileID string) ([]string, error) {
	var keys []string
	err := s.withTx(ctx, func(tx pgx.Tx) error {
		var count int
		// Lock the user's profiles so two concurrent deletes can't remove the last two.
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM (SELECT 1 FROM profiles WHERE user_id = $1 FOR UPDATE) p`, userID).Scan(&count); err != nil {
			return err
		}
		if err := s.checkProfileTx(ctx, tx, userID, profileID); err != nil {
			return err
		}
		if count <= 1 {
			return ErrConflict
		}
		rows, err := tx.Query(ctx, `SELECT storage_key FROM documents WHERE profile_id = $1`, profileID)
		if err != nil {
			return err
		}
		keys, err = pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM profiles WHERE id = $1`, profileID)
		return err
	})
	return keys, err
}

func (s *Store) checkProfileTx(ctx context.Context, tx pgx.Tx, userID, profileID string) error {
	var ok bool
	return notFound(tx.QueryRow(ctx, `SELECT true FROM profiles WHERE id = $1 AND user_id = $2`, profileID, userID).Scan(&ok))
}
