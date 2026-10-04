package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"medvault/internal/extraction"
)

type Item struct {
	ID         string          `json:"id"`
	DocumentID string          `json:"document_id"`
	ProfileID  string          `json:"profile_id"`
	Kind       string          `json:"kind"`
	Data       json.RawMessage `json:"data"`
	SourceText *string         `json:"source_text"`
	Confidence float64         `json:"confidence"`
	Grounded   bool            `json:"grounded"`
	Issues     []string        `json:"issues"`
	Status     string          `json:"status"`
	ReviewedBy *string         `json:"reviewed_by"`
	CreatedAt  time.Time       `json:"created_at"`
	ReviewedAt *time.Time      `json:"reviewed_at"`

	Document *ItemDocument `json:"document,omitempty"` // review queue only
}

type ItemDocument struct {
	ID       string  `json:"id"`
	Filename string  `json:"filename"`
	Title    *string `json:"title"`
	DocType  string  `json:"doc_type"`
	DocDate  *string `json:"doc_date"`
}

const itemCols = `i.id::text, i.document_id::text, i.profile_id::text, i.kind, i.data, i.source_text,
	i.confidence, i.grounded, i.issues, i.status, i.reviewed_by, i.created_at, i.reviewed_at`

func scanItem(row pgx.Row, extra ...any) (*Item, error) {
	var it Item
	dest := []any{&it.ID, &it.DocumentID, &it.ProfileID, &it.Kind, &it.Data, &it.SourceText,
		&it.Confidence, &it.Grounded, &it.Issues, &it.Status, &it.ReviewedBy, &it.CreatedAt, &it.ReviewedAt}
	if err := row.Scan(append(dest, extra...)...); err != nil {
		return nil, notFound(err)
	}
	if it.Issues == nil {
		it.Issues = []string{}
	}
	return &it, nil
}

// NewItem is a validated extraction ready to store. Value is the typed,
// cleaned payload (*extraction.LabResult etc.) used for materialization.
type NewItem struct {
	Kind       string
	Data       json.RawMessage
	Value      any
	SourceText *string
	Confidence float64
	Grounded   bool
	Issues     []string
	Accepted   bool
}

type ExtractionResult struct {
	Items             []NewItem
	DocDate, Facility *string
	Provider          string
	Model             *string
}

// SaveExtraction atomically replaces a document's extracted items, materializes
// the auto-accepted ones, fills in AI-derived metadata the user hasn't set, and
// sets the final status (needs_review if anything awaits the user).
func (s *Store) SaveExtraction(ctx context.Context, docID, profileID string, r ExtractionResult) (status string, err error) {
	err = s.withTx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM extracted_items WHERE document_id = $1`, docID); err != nil {
			return err
		}
		pending := 0
		for pos, it := range r.Items {
			st, by := "needs_review", (*string)(nil)
			if it.Accepted {
				auto := "auto"
				st, by = "accepted", &auto
			} else {
				pending++
			}
			issues := it.Issues
			if issues == nil {
				issues = []string{}
			}
			var itemID string
			err := tx.QueryRow(ctx, `INSERT INTO extracted_items
				(document_id, profile_id, kind, data, source_text, confidence, grounded, issues, status, reviewed_by, position, reviewed_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $9 = 'accepted' THEN now() END)
				RETURNING id::text`,
				docID, profileID, it.Kind, it.Data, it.SourceText, clamp01(it.Confidence), it.Grounded, issues, st, by, pos,
			).Scan(&itemID)
			if err != nil {
				return fmt.Errorf("insert item %d: %w", pos, err)
			}
			if it.Accepted {
				if err := materialize(ctx, tx, itemID, docID, profileID, it.Value); err != nil {
					return fmt.Errorf("materialize item %d: %w", pos, err)
				}
			}
		}
		status = "completed"
		if pending > 0 {
			status = "needs_review"
		}
		_, err := tx.Exec(ctx, `UPDATE documents SET
				doc_date = CASE WHEN doc_date_source = 'user' THEN doc_date ELSE COALESCE($2::date, doc_date) END,
				source = COALESCE(source, $3),
				extraction_provider = $4, extraction_model = $5,
				status = $6, stage = 'done', error = NULL, updated_at = now()
			WHERE id = $1`, docID, r.DocDate, r.Facility, r.Provider, r.Model, status)
		return err
	})
	return status, err
}

func clamp01(v float64) float64 {
	return max(0, min(1, v))
}

// materialize writes an accepted item into its structured table.
func materialize(ctx context.Context, tx pgx.Tx, itemID, docID, profileID string, v any) error {
	var err error
	switch x := v.(type) {
	case *extraction.LabResult:
		_, err = tx.Exec(ctx, `INSERT INTO lab_results
			(profile_id, document_id, item_id, code, name, test_name_original, value, value_text, unit,
			 value_original, unit_original, reference_low, reference_high, flag, measured_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::date)`,
			profileID, docID, itemID, x.LabCode(), x.DisplayName(), x.TestNameOriginal, x.Value, x.ValueText, x.Unit,
			x.ValueOriginal, x.UnitOriginal, x.ReferenceLow, x.ReferenceHigh, x.Flag, x.MeasuredAt)
	case *extraction.Medication:
		var medID string
		err = tx.QueryRow(ctx, `INSERT INTO medications (profile_id, canonical_key, generic_name) VALUES ($1, $2, $3)
			ON CONFLICT (profile_id, canonical_key) DO UPDATE SET generic_name = EXCLUDED.generic_name
			RETURNING id::text`, profileID, x.Key(), x.Name()).Scan(&medID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO medication_events
			(medication_id, profile_id, document_id, item_id, brand_name, name_original, form, dose_value, dose_unit,
			 frequency_code, times_per_day, schedule, timing, duration_days, instructions)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
			medID, profileID, docID, itemID, x.BrandName, x.NameOriginal, x.Form, x.DoseValue, x.DoseUnit,
			x.FrequencyCode, x.TimesPerDay, x.Schedule, x.Timing, x.DurationDays, x.Instructions)
	case *extraction.Diagnosis:
		_, err = tx.Exec(ctx, `INSERT INTO conditions (profile_id, document_id, item_id, name, status) VALUES ($1, $2, $3, $4, $5)`,
			profileID, docID, itemID, x.Name, x.Status)
	case *extraction.Allergy:
		_, err = tx.Exec(ctx, `INSERT INTO allergies (profile_id, document_id, item_id, substance, reaction) VALUES ($1, $2, $3, $4, $5)`,
			profileID, docID, itemID, x.Substance, x.Reaction)
	case *extraction.Encounter:
		_, err = tx.Exec(ctx, `INSERT INTO encounters (profile_id, document_id, item_id, type, date, facility, doctor, notes)
			VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8)`,
			profileID, docID, itemID, x.Type, x.Date, x.Facility, x.Doctor, x.Notes)
	default:
		return fmt.Errorf("cannot materialize %T", v)
	}
	return err
}

func dematerialize(ctx context.Context, tx pgx.Tx, itemID string) error {
	for _, table := range []string{"lab_results", "medication_events", "conditions", "allergies", "encounters"} {
		if _, err := tx.Exec(ctx, `DELETE FROM `+table+` WHERE item_id = $1`, itemID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) DocumentItems(ctx context.Context, userID, docID string) ([]Item, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+itemCols+` FROM extracted_items i
		JOIN profiles p ON p.id = i.profile_id
		WHERE i.document_id = $1 AND p.user_id = $2 ORDER BY i.position`, docID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Item{}
	for rows.Next() {
		it, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *it)
	}
	return out, rows.Err()
}

func (s *Store) ReviewQueue(ctx context.Context, userID, profileID string) ([]Item, error) {
	if err := s.CheckProfile(ctx, userID, profileID); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT `+itemCols+`, d.id::text, d.filename, d.title, d.doc_type, to_char(d.doc_date, 'YYYY-MM-DD')
		FROM extracted_items i JOIN documents d ON d.id = i.document_id
		WHERE i.profile_id = $1 AND i.status = 'needs_review'
		ORDER BY i.created_at, i.position`, profileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Item{}
	for rows.Next() {
		var doc ItemDocument
		it, err := scanItem(rows, &doc.ID, &doc.Filename, &doc.Title, &doc.DocType, &doc.DocDate)
		if err != nil {
			return nil, err
		}
		it.Document = &doc
		out = append(out, *it)
	}
	return out, rows.Err()
}

// ValidationError carries field problems back to the HTTP layer (422).
type ValidationError struct{ Problems extraction.Problems }

func (e *ValidationError) Error() string { return "validation failed" }

// ReviewItem accepts (optionally with corrected data) or rejects an item.
// Accepted data is re-validated with the same gatekeeper as AI output.
func (s *Store) ReviewItem(ctx context.Context, userID, itemID, action string, data json.RawMessage) (*Item, error) {
	err := s.withTx(ctx, func(tx pgx.Tx) error {
		it, err := scanItem(tx.QueryRow(ctx, `SELECT `+itemCols+` FROM extracted_items i
			JOIN profiles p ON p.id = i.profile_id WHERE i.id = $1 AND p.user_id = $2 FOR UPDATE OF i`, itemID, userID))
		if err != nil {
			return err
		}
		if err := dematerialize(ctx, tx, itemID); err != nil {
			return err
		}
		switch action {
		case "reject":
			if _, err := tx.Exec(ctx, `UPDATE extracted_items SET status = 'rejected', reviewed_by = 'user', reviewed_at = now()
				WHERE id = $1`, itemID); err != nil {
				return err
			}
		case "accept":
			raw := it.Data
			if len(data) > 0 {
				raw = data
			}
			v, cleaned, problems, err := extraction.Validate(it.Kind, raw, s.Today())
			if err != nil {
				return &ValidationError{Problems: extraction.Problems{"data": err.Error()}}
			}
			if len(problems) > 0 {
				return &ValidationError{Problems: problems}
			}
			edited := len(data) > 0
			if _, err := tx.Exec(ctx, `UPDATE extracted_items SET status = 'accepted', reviewed_by = 'user', reviewed_at = now(),
				data = $2, issues = CASE WHEN $3 THEN '[]'::jsonb ELSE issues END WHERE id = $1`, itemID, cleaned, edited); err != nil {
				return err
			}
			if err := materialize(ctx, tx, itemID, it.DocumentID, it.ProfileID, v); err != nil {
				return err
			}
		default:
			return &ValidationError{Problems: extraction.Problems{"action": `must be "accept" or "reject"`}}
		}
		// Recompute document status from what is still pending.
		_, err = tx.Exec(ctx, `UPDATE documents SET updated_at = now(), status = CASE
				WHEN EXISTS (SELECT 1 FROM extracted_items WHERE document_id = $1 AND status = 'needs_review') THEN 'needs_review'
				ELSE 'completed' END
			WHERE id = $1 AND status IN ('needs_review', 'completed')`, it.DocumentID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return scanItem(s.pool.QueryRow(ctx, `SELECT `+itemCols+` FROM extracted_items i WHERE i.id = $1`, itemID))
}
