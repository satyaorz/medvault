package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type Document struct {
	ID                       string    `json:"id"`
	ProfileID                string    `json:"profile_id"`
	Filename                 string    `json:"filename"`
	ContentType              string    `json:"content_type"`
	SizeBytes                int64     `json:"size_bytes"`
	Title                    *string   `json:"title"`
	DocType                  string    `json:"doc_type"`
	DocTypeSource            string    `json:"doc_type_source"`
	DocDate                  *string   `json:"doc_date"`
	Source                   *string   `json:"source"`
	Status                   string    `json:"status"`
	Stage                    string    `json:"stage"`
	Error                    *string   `json:"error"`
	ClassificationConfidence *float64  `json:"classification_confidence"`
	OCRMethod                *string   `json:"ocr_method"`
	OCRConfidence            *float64  `json:"ocr_confidence"`
	PageCount                *int      `json:"page_count"`
	PendingItems             int       `json:"pending_items"`
	ItemCount                int       `json:"item_count"`
	CreatedAt                time.Time `json:"created_at"`
	UpdatedAt                time.Time `json:"updated_at"`

	// Only on GET /documents/{id}.
	OCRText *string `json:"ocr_text,omitempty"`
	Steps   []Step  `json:"steps,omitempty"`

	StorageKey    string `json:"-"`
	DocDateSource string `json:"-"`
}

type Step struct {
	Stage      string     `json:"stage"`
	Status     string     `json:"status"`
	Message    *string    `json:"message"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at"`
}

const documentCols = `d.id::text, d.profile_id::text, d.filename, d.content_type, d.size_bytes, d.title, d.doc_type,
	d.doc_type_source, to_char(d.doc_date, 'YYYY-MM-DD'), d.source, d.status, d.stage, d.error,
	d.classification_confidence, d.ocr_method, d.ocr_confidence, d.page_count,
	(SELECT count(*) FROM extracted_items i WHERE i.document_id = d.id AND i.status = 'needs_review'),
	(SELECT count(*) FROM extracted_items i WHERE i.document_id = d.id),
	d.created_at, d.updated_at, d.storage_key, d.doc_date_source`

func scanDocument(row pgx.Row, extra ...any) (*Document, error) {
	var d Document
	dest := []any{&d.ID, &d.ProfileID, &d.Filename, &d.ContentType, &d.SizeBytes, &d.Title, &d.DocType,
		&d.DocTypeSource, &d.DocDate, &d.Source, &d.Status, &d.Stage, &d.Error,
		&d.ClassificationConfidence, &d.OCRMethod, &d.OCRConfidence, &d.PageCount,
		&d.PendingItems, &d.ItemCount, &d.CreatedAt, &d.UpdatedAt, &d.StorageKey, &d.DocDateSource}
	if err := row.Scan(append(dest, extra...)...); err != nil {
		return nil, notFound(err)
	}
	return &d, nil
}

type NewDocument struct {
	ID, ProfileID, Filename, ContentType, SHA256, StorageKey string
	SizeBytes                                                int64
	Title, DocType, DocDate, Source                          *string
}

// FindDuplicate returns the ID of a document with identical content in the profile.
func (s *Store) FindDuplicate(ctx context.Context, profileID, sha string) (string, bool, error) {
	var id string
	err := s.pool.QueryRow(ctx, `SELECT id::text FROM documents WHERE profile_id = $1 AND sha256 = $2`, profileID, sha).Scan(&id)
	if err == pgx.ErrNoRows {
		return "", false, nil
	}
	return id, err == nil, err
}

// CreateDocument inserts a queued document. A user-supplied type/date is
// recorded as such so the AI pipeline will not overwrite it.
func (s *Store) CreateDocument(ctx context.Context, n NewDocument) (*Document, error) {
	docType, typeSource := "unknown", "ai"
	if n.DocType != nil {
		docType, typeSource = *n.DocType, "user"
	}
	dateSource := "ai"
	if n.DocDate != nil {
		dateSource = "user"
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO documents
		(id, profile_id, filename, content_type, size_bytes, sha256, storage_key, title, doc_type, doc_type_source, doc_date, doc_date_source, source)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, $13)`,
		n.ID, n.ProfileID, n.Filename, n.ContentType, n.SizeBytes, n.SHA256, n.StorageKey,
		n.Title, docType, typeSource, n.DocDate, dateSource, n.Source)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrConflict
		}
		return nil, err
	}
	return s.documentByID(ctx, n.ID)
}

type DocumentFilter struct {
	Query, Type, Status, From, To string
	Limit, Offset                 int
}

func (s *Store) ListDocuments(ctx context.Context, userID, profileID string, f DocumentFilter) ([]Document, int, error) {
	if err := s.CheckProfile(ctx, userID, profileID); err != nil {
		return nil, 0, err
	}
	where := []string{"d.profile_id = $1"}
	args := []any{profileID}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, strings.ReplaceAll(cond, "?", fmt.Sprintf("$%d", len(args))))
	}
	if f.Query != "" {
		add(`(d.search @@ websearch_to_tsquery('english', ?) OR d.filename ILIKE '%' || ? || '%' OR d.title ILIKE '%' || ? || '%')`, f.Query)
	}
	if f.Type != "" {
		add("d.doc_type = ?", f.Type)
	}
	if f.Status != "" {
		add("d.status = ?", f.Status)
	}
	if f.From != "" {
		add(effDate+" >= ?::date", f.From)
	}
	if f.To != "" {
		add(effDate+" <= ?::date", f.To)
	}
	cond := strings.Join(where, " AND ")

	var total int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM documents d WHERE `+cond, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, f.Limit, f.Offset)
	rows, err := s.pool.Query(ctx, fmt.Sprintf(`SELECT %s FROM documents d WHERE %s
		ORDER BY d.doc_date DESC NULLS LAST, d.created_at DESC LIMIT $%d OFFSET $%d`,
		documentCols, cond, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	docs := []Document{}
	for rows.Next() {
		d, err := scanDocument(rows)
		if err != nil {
			return nil, 0, err
		}
		docs = append(docs, *d)
	}
	return docs, total, rows.Err()
}

// GetDocument returns an owned document, optionally with OCR text and steps.
func (s *Store) GetDocument(ctx context.Context, userID, docID string, detail bool) (*Document, error) {
	var ocr *string
	d, err := scanDocument(s.pool.QueryRow(ctx, `SELECT `+documentCols+`, d.ocr_text FROM documents d
		JOIN profiles p ON p.id = d.profile_id WHERE d.id = $1 AND p.user_id = $2`, docID, userID), &ocr)
	if err != nil {
		return nil, err
	}
	if detail {
		d.OCRText = ocr
		if d.Steps, err = s.steps(ctx, docID); err != nil {
			return nil, err
		}
	}
	return d, nil
}

func (s *Store) documentByID(ctx context.Context, docID string) (*Document, error) {
	return scanDocument(s.pool.QueryRow(ctx, `SELECT `+documentCols+` FROM documents d WHERE d.id = $1`, docID))
}

func (s *Store) steps(ctx context.Context, docID string) ([]Step, error) {
	rows, err := s.pool.Query(ctx, `SELECT stage, status, message, started_at, finished_at
		FROM processing_steps WHERE document_id = $1 ORDER BY id`, docID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Step, error) {
		var st Step
		err := r.Scan(&st.Stage, &st.Status, &st.Message, &st.StartedAt, &st.FinishedAt)
		return st, err
	})
}

type DocumentPatch struct {
	Title, DocDate, DocType, Source *string
}

func (s *Store) UpdateDocument(ctx context.Context, userID, docID string, p DocumentPatch) (*Document, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE documents d SET
			title = COALESCE($3, title),
			doc_date = COALESCE($4::date, doc_date),
			doc_date_source = CASE WHEN $4::date IS NULL THEN doc_date_source ELSE 'user' END,
			doc_type = COALESCE($5, doc_type),
			doc_type_source = CASE WHEN $5::text IS NULL THEN doc_type_source ELSE 'user' END,
			source = COALESCE($6, source),
			updated_at = now()
		FROM profiles p WHERE p.id = d.profile_id AND d.id = $1 AND p.user_id = $2`,
		docID, userID, p.Title, p.DocDate, p.DocType, p.Source)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return s.GetDocument(ctx, userID, docID, false)
}

// DeleteDocument removes the row (cascading to items and the record) and
// returns its storage key.
func (s *Store) DeleteDocument(ctx context.Context, userID, docID string) (string, error) {
	var key string
	err := s.pool.QueryRow(ctx, `DELETE FROM documents d USING profiles p
		WHERE p.id = d.profile_id AND d.id = $1 AND p.user_id = $2 RETURNING d.storage_key`, docID, userID).Scan(&key)
	return key, notFound(err)
}

// ResetForReprocess drops previous extraction results and re-queues the
// document. Refuses (ErrConflict) while a job is already queued or running.
func (s *Store) ResetForReprocess(ctx context.Context, userID, docID string) (*Document, error) {
	err := s.withTx(ctx, func(tx pgx.Tx) error {
		var status string
		err := tx.QueryRow(ctx, `SELECT d.status FROM documents d JOIN profiles p ON p.id = d.profile_id
			WHERE d.id = $1 AND p.user_id = $2 FOR UPDATE OF d`, docID, userID).Scan(&status)
		if err != nil {
			return notFound(err)
		}
		if status == "queued" || status == "processing" {
			return ErrConflict
		}
		for _, q := range []string{
			`DELETE FROM extracted_items WHERE document_id = $1`,
			`DELETE FROM processing_steps WHERE document_id = $1`,
			`UPDATE documents SET status = 'queued', stage = 'queued', error = NULL, updated_at = now() WHERE id = $1`,
		} {
			if _, err := tx.Exec(ctx, q, docID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetDocument(ctx, userID, docID, false)
}

// ---- pipeline-side (worker) methods; no user scoping ----------------------

// ProcessingDocument is what the worker needs to process a document.
type ProcessingDocument struct {
	ID, ProfileID, Filename, ContentType, StorageKey string
	DocType, DocTypeSource, DocDateSource             string
	Title, Source                                     *string
}

func (s *Store) DocumentForProcessing(ctx context.Context, docID string) (*ProcessingDocument, error) {
	var d ProcessingDocument
	err := s.pool.QueryRow(ctx, `SELECT id::text, profile_id::text, filename, content_type, storage_key,
			doc_type, doc_type_source, doc_date_source, title, source
		FROM documents WHERE id = $1`, docID).
		Scan(&d.ID, &d.ProfileID, &d.Filename, &d.ContentType, &d.StorageKey,
			&d.DocType, &d.DocTypeSource, &d.DocDateSource, &d.Title, &d.Source)
	if err != nil {
		return nil, notFound(err)
	}
	return &d, nil
}

func (s *Store) SetDocumentState(ctx context.Context, docID, status, stage string, errMsg *string) error {
	_, err := s.pool.Exec(ctx, `UPDATE documents SET status = $2, stage = $3, error = $4, updated_at = now() WHERE id = $1`,
		docID, status, stage, errMsg)
	return err
}

func (s *Store) SetStage(ctx context.Context, docID, stage string) error {
	_, err := s.pool.Exec(ctx, `UPDATE documents SET status = 'processing', stage = $2, updated_at = now() WHERE id = $1`, docID, stage)
	return err
}

func (s *Store) StartStep(ctx context.Context, docID, stage string) (int64, error) {
	var id int64
	err := s.pool.QueryRow(ctx, `INSERT INTO processing_steps (document_id, stage, status) VALUES ($1, $2, 'running') RETURNING id`,
		docID, stage).Scan(&id)
	return id, err
}

func (s *Store) FinishStep(ctx context.Context, stepID int64, status, message string) error {
	_, err := s.pool.Exec(ctx, `UPDATE processing_steps SET status = $2, message = $3, finished_at = now() WHERE id = $1`,
		stepID, status, message)
	return err
}

func (s *Store) SaveOCR(ctx context.Context, docID, text, method string, confidence float64, pages int) error {
	_, err := s.pool.Exec(ctx, `UPDATE documents SET ocr_text = $2, ocr_method = $3, ocr_confidence = $4, page_count = $5,
		updated_at = now() WHERE id = $1`, docID, text, method, confidence, pages)
	return err
}

// SaveClassification stores the AI's type unless the user already chose one.
func (s *Store) SaveClassification(ctx context.Context, docID, docType string, confidence float64) error {
	_, err := s.pool.Exec(ctx, `UPDATE documents SET classification_confidence = $3,
		doc_type = CASE WHEN doc_type_source = 'user' THEN doc_type ELSE $2 END, updated_at = now() WHERE id = $1`,
		docID, docType, confidence)
	return err
}
