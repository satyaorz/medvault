package api_test

// Integration tests: real HTTP router + real PostgreSQL + real pipeline, with
// in-memory object storage and a scripted fake AI service.
//
// Needs Postgres (docker compose up -d). Uses TEST_DATABASE_URL or the local
// default and creates a throwaway database; skipped if Postgres is unreachable.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"medvault/internal/aiclient"
	"medvault/internal/api"
	"medvault/internal/auth"
	"medvault/internal/db"
	"medvault/internal/pipeline"
	"medvault/internal/store"
)

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	os.Exit(runMain(m))
}

func runMain(m *testing.M) int {
	admin := os.Getenv("TEST_DATABASE_URL")
	if admin == "" {
		admin = "postgres://medvault:medvault@localhost:5432/medvault?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		fmt.Println("skipping API integration tests: postgres unavailable:", err)
		return 0
	}
	name := fmt.Sprintf("medvault_test_%d", time.Now().UnixNano())
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		fmt.Println("create test db:", err)
		return 1
	}
	defer func() {
		if testPool != nil {
			testPool.Close()
		}
		conn.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)") //nolint:errcheck
		conn.Close(ctx)
	}()

	cfg, _ := pgx.ParseConfig(admin)
	url := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable", cfg.User, cfg.Password, cfg.Host, cfg.Port, name)
	if testPool, err = db.Open(ctx, url); err != nil {
		fmt.Println(err)
		return 1
	}
	if err := db.Migrate(ctx, testPool); err != nil {
		fmt.Println(err)
		return 1
	}
	if err := db.Migrate(ctx, testPool); err != nil { // idempotent
		fmt.Println("second migrate:", err)
		return 1
	}
	return m.Run()
}

// ---- fakes --------------------------------------------------------------------

type memFiles struct {
	mu   sync.Mutex
	data map[string][]byte
}

func (m *memFiles) Put(_ context.Context, key, _ string, b []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[key] = append([]byte(nil), b...)
	return nil
}
func (m *memFiles) Get(_ context.Context, key string) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	b, ok := m.data[key]
	if !ok {
		return nil, fmt.Errorf("no such key %s", key)
	}
	return b, nil
}
func (m *memFiles) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	b, err := m.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	return io.NopCloser(bytes.NewReader(b)), nil
}
func (m *memFiles) Delete(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.data, key)
	return nil
}
func (m *memFiles) Ping(context.Context) error { return nil }
func (m *memFiles) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.data)
}

// fakeAI returns a lab report with a mix of clean, doubtful and broken items.
type fakeAI struct{ extractCalls int }

const labText = "Apollo Diagnostics\nDate: 12/01/2026\nHGB 132 g/L 130-170\nHbA1c 5.8 %\nSerum Zinc 70 ug/dL"

func (f *fakeAI) OCR(context.Context, string, string, []byte) (*aiclient.OCRResult, error) {
	return &aiclient.OCRResult{Text: labText, PageCount: 1, Method: "text_layer", MeanConfidence: 1}, nil
}
func (f *fakeAI) Classify(context.Context, string) (*aiclient.ClassifyResult, error) {
	return &aiclient.ClassifyResult{DocType: "lab_report", Confidence: 0.93, Method: "rules"}, nil
}
func (f *fakeAI) Extract(context.Context, string, string, float64) (*aiclient.ExtractResult, error) {
	f.extractCalls++
	s := func(v string) *string { return &v }
	return &aiclient.ExtractResult{
		DocType: "lab_report", Provider: "rules",
		Document: aiclient.DocumentMeta{Date: s("2026-01-12"), Facility: s("Apollo Diagnostics")},
		Items: []aiclient.Item{
			{Kind: "lab_result", Confidence: 0.95, Grounded: true, SourceText: s("HGB 132 g/L 130-170"),
				Data: json.RawMessage(`{"test_name_original":"HGB","canonical_code":"hemoglobin","canonical_name":"Hemoglobin","value":13.2,"unit":"g/dL","value_original":132,"unit_original":"g/L","reference_low":13,"reference_high":17,"flag":"normal","measured_at":null}`)},
			{Kind: "lab_result", Confidence: 0.92, Grounded: true, SourceText: s("HbA1c 5.8 %"),
				Data: json.RawMessage(`{"test_name_original":"HbA1c","canonical_code":"hba1c","canonical_name":"HbA1c","value":5.8,"unit":"%","flag":"normal"}`)},
			// Unrecognized test → AI flags it → needs review.
			{Kind: "lab_result", Confidence: 0.6, Grounded: true, SourceText: s("Serum Zinc 70 ug/dL"), Issues: []string{"unrecognized test name"},
				Data: json.RawMessage(`{"test_name_original":"Serum Zinc","value":70,"unit":"ug/dL"}`)},
			// High confidence but invalid enum → gatekeeper forces review.
			{Kind: "lab_result", Confidence: 0.99, Grounded: true, SourceText: s("HbA1c 5.8 %"),
				Data: json.RawMessage(`{"test_name_original":"HbA1c","value":5.8,"flag":"critical"}`)},
			// Not grounded in the text → review even though confident.
			{Kind: "medication", Confidence: 0.97, Grounded: false, SourceText: s("Tab Metformin 500 BD"),
				Data: json.RawMessage(`{"name_original":"Tab Metformin 500","generic_name":"Metformin","canonical_key":"metformin","dose_value":500,"dose_unit":"mg","frequency_code":"BD"}`)},
			// Unknown kind and malformed payload are discarded.
			{Kind: "vital_sign", Confidence: 1, Grounded: true, Data: json.RawMessage(`{}`)},
			{Kind: "lab_result", Confidence: 1, Grounded: true, Data: json.RawMessage(`{"value":"oops"}`)},
		},
	}, nil
}

// syncQueue processes documents inline instead of through Redis.
type syncQueue struct {
	proc    *pipeline.Processor
	pending []string
}

func (q *syncQueue) EnqueueProcessDocument(id string) error {
	q.pending = append(q.pending, id)
	return nil
}

func (q *syncQueue) drain(t *testing.T) {
	t.Helper()
	for _, id := range q.pending {
		if err := q.proc.Process(context.Background(), id); err != nil {
			t.Fatalf("process %s: %v", id, err)
		}
	}
	q.pending = nil
}

type env struct {
	srv   *httptest.Server
	files *memFiles
	queue *syncQueue
	ai    *fakeAI
}

func newEnv(t *testing.T) *env {
	t.Helper()
	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `TRUNCATE users CASCADE`); err != nil {
		t.Fatal(err)
	}
	st := store.New(testPool)
	st.Today = func() time.Time { return time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC) }
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	files := &memFiles{data: map[string][]byte{}}
	ai := &fakeAI{}
	q := &syncQueue{proc: &pipeline.Processor{Store: st, Files: files, AI: ai, Log: log}}
	s := &api.Server{
		Store: st, Files: files, Queue: q, Log: log, MaxUploadBytes: 1 << 20,
		Tokens: auth.NewTokens([]byte("test-secret-test-secret-test-secret!"), time.Hour),
	}
	e := &env{srv: httptest.NewServer(s.Routes()), files: files, queue: q, ai: ai}
	t.Cleanup(e.srv.Close)
	return e
}

// ---- tiny HTTP client -----------------------------------------------------------

type client struct {
	t    *testing.T
	base string
	http *http.Client
}

func (e *env) client(t *testing.T) *client {
	jar, _ := cookiejar.New(nil)
	return &client{t: t, base: e.srv.URL, http: &http.Client{Jar: jar}}
}

type resp struct {
	status int
	body   []byte
	header http.Header
}

func (r resp) json(t *testing.T, v any) {
	t.Helper()
	if err := json.Unmarshal(r.body, v); err != nil {
		t.Fatalf("decode %s: %v", r.body, err)
	}
}

func (c *client) do(method, path string, body any) resp {
	c.t.Helper()
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.base+path, rdr)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return c.send(req)
}

func (c *client) send(req *http.Request) resp {
	c.t.Helper()
	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return resp{status: res.StatusCode, body: b, header: res.Header}
}

func (c *client) upload(profileID, filename string, data []byte, fields map[string]string) resp {
	c.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		mw.WriteField(k, v) //nolint:errcheck
	}
	fw, _ := mw.CreateFormFile("file", filename)
	fw.Write(data) //nolint:errcheck
	mw.Close()
	req, _ := http.NewRequest(http.MethodPost, c.base+"/api/profiles/"+profileID+"/documents", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return c.send(req)
}

func expect(t *testing.T, r resp, status int) {
	t.Helper()
	if r.status != status {
		t.Fatalf("status %d, want %d: %s", r.status, status, r.body)
	}
}

func (c *client) register(email string) string {
	c.t.Helper()
	r := c.do("POST", "/api/auth/register", map[string]string{"email": email, "password": "password123", "name": "Satya"})
	expect(c.t, r, http.StatusCreated)
	var out struct {
		Profiles []store.Profile `json:"profiles"`
	}
	c.do("GET", "/api/profiles", nil).json(c.t, &out)
	return out.Profiles[0].ID
}

var pngBytes = append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 64)...)

func pdfBytes(n int) []byte { return []byte(fmt.Sprintf("%%PDF-1.4\n%% sample %d\n%%%%EOF", n)) }

// ---- tests ----------------------------------------------------------------------

func TestAuthFlow(t *testing.T) {
	e := newEnv(t)
	c := e.client(t)

	expect(t, c.do("GET", "/api/auth/me", nil), http.StatusUnauthorized)

	r := c.do("POST", "/api/auth/register", map[string]string{"email": "bad", "password": "short", "name": ""})
	expect(t, r, http.StatusUnprocessableEntity)
	var ve struct {
		Error struct{ Fields map[string]string } `json:"error"`
	}
	r.json(t, &ve)
	for _, f := range []string{"email", "password", "name"} {
		if ve.Error.Fields[f] == "" {
			t.Errorf("expected field error for %s: %s", f, r.body)
		}
	}

	r = c.do("POST", "/api/auth/register", map[string]string{"email": "satya@example.com", "password": "password123", "name": "Satya"})
	expect(t, r, http.StatusCreated)
	if !strings.Contains(r.header.Get("Set-Cookie"), "HttpOnly") {
		t.Error("session cookie must be HttpOnly")
	}
	expect(t, c.do("GET", "/api/auth/me", nil), http.StatusOK)

	// Registration creates a "self" profile.
	var ps struct{ Profiles []store.Profile }
	c.do("GET", "/api/profiles", nil).json(t, &ps)
	if len(ps.Profiles) != 1 || ps.Profiles[0].Relationship != "self" || ps.Profiles[0].Name != "Satya" {
		t.Fatalf("self profile not created: %+v", ps)
	}

	other := e.client(t)
	expect(t, other.do("POST", "/api/auth/register", map[string]string{"email": "SATYA@example.com", "password": "password123", "name": "X"}), http.StatusConflict)
	expect(t, other.do("POST", "/api/auth/login", map[string]string{"email": "satya@example.com", "password": "wrong-password"}), http.StatusUnauthorized)
	expect(t, other.do("POST", "/api/auth/login", map[string]string{"email": "nobody@example.com", "password": "password123"}), http.StatusUnauthorized)
	expect(t, other.do("POST", "/api/auth/login", map[string]string{"email": "Satya@Example.com", "password": "password123"}), http.StatusOK)

	expect(t, c.do("POST", "/api/auth/logout", nil), http.StatusNoContent)
	expect(t, c.do("GET", "/api/auth/me", nil), http.StatusUnauthorized)

	// Unknown JSON fields are rejected.
	expect(t, other.do("POST", "/api/profiles", map[string]any{"name": "A", "relationship": "parent", "is_admin": true}), http.StatusBadRequest)
}

func TestLoginRateLimit(t *testing.T) {
	e := newEnv(t)
	c := e.client(t)
	// Malformed bodies fail fast (no bcrypt) but still consume tokens, keeping
	// the test independent of hashing speed (e.g. under -race).
	var last int
	for i := 0; i < 12; i++ {
		last = c.do("POST", "/api/auth/login", "not-an-object").status
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("12th login attempt got %d, want 429", last)
	}
}

func TestProfiles(t *testing.T) {
	e := newEnv(t)
	c := e.client(t)
	self := c.register("a@example.com")

	expect(t, c.do("DELETE", "/api/profiles/"+self, nil), http.StatusConflict) // last profile

	r := c.do("POST", "/api/profiles", map[string]any{"name": "Dad", "relationship": "parent", "date_of_birth": "1960-04-02", "sex": "male"})
	expect(t, r, http.StatusCreated)
	var created struct{ Profile store.Profile }
	r.json(t, &created)
	dad := created.Profile.ID
	if *created.Profile.DateOfBirth != "1960-04-02" {
		t.Errorf("dob = %v", created.Profile.DateOfBirth)
	}

	expect(t, c.do("POST", "/api/profiles", map[string]any{"name": "X", "relationship": "cousin"}), http.StatusUnprocessableEntity)
	expect(t, c.do("POST", "/api/profiles", map[string]any{"name": "X", "relationship": "child", "date_of_birth": "2999-01-01"}), http.StatusUnprocessableEntity)

	// PATCH: explicit null clears, absent keeps.
	r = c.do("PATCH", "/api/profiles/"+dad, map[string]any{"name": "Papa", "date_of_birth": nil})
	expect(t, r, http.StatusOK)
	var upd struct{ Profile store.Profile }
	r.json(t, &upd)
	if upd.Profile.Name != "Papa" || upd.Profile.DateOfBirth != nil || *upd.Profile.Sex != "male" {
		t.Errorf("patch semantics wrong: %+v", upd.Profile)
	}

	// Another user cannot see or touch it.
	mallory := e.client(t)
	mallory.register("m@example.com")
	expect(t, mallory.do("GET", "/api/profiles/"+dad, nil), http.StatusNotFound)
	expect(t, mallory.do("PATCH", "/api/profiles/"+dad, map[string]any{"name": "pwned"}), http.StatusNotFound)
	expect(t, mallory.do("DELETE", "/api/profiles/"+dad, nil), http.StatusNotFound)
	expect(t, mallory.upload(dad, "x.png", pngBytes, nil), http.StatusNotFound)
	expect(t, mallory.do("GET", "/api/profiles/not-a-uuid", nil), http.StatusNotFound)

	expect(t, c.do("DELETE", "/api/profiles/"+dad, nil), http.StatusNoContent)
	expect(t, c.do("GET", "/api/profiles/"+dad, nil), http.StatusNotFound)
}

func TestUploadValidation(t *testing.T) {
	e := newEnv(t)
	c := e.client(t)
	pid := c.register("u@example.com")

	expect(t, c.upload(pid, "notes.txt", []byte("just some text, not a medical file"), nil), http.StatusUnsupportedMediaType)
	// A text file renamed to .pdf is still rejected: content is sniffed.
	expect(t, c.upload(pid, "fake.pdf", []byte("hello world"), nil), http.StatusUnsupportedMediaType)
	expect(t, c.upload(pid, "big.pdf", append(pdfBytes(0), bytes.Repeat([]byte("x"), 2<<20)...), nil), http.StatusRequestEntityTooLarge)
	expect(t, c.upload(pid, "a.png", pngBytes, map[string]string{"doc_type": "selfie"}), http.StatusUnprocessableEntity)
	expect(t, c.upload(pid, "a.png", pngBytes, map[string]string{"doc_date": "2030-01-01"}), http.StatusUnprocessableEntity)

	r := c.upload(pid, `../../etc/"passwd".png`, pngBytes, map[string]string{"title": "Scan", "doc_date": "2026-02-01"})
	expect(t, r, http.StatusAccepted)
	var up struct{ Document store.Document }
	r.json(t, &up)
	if up.Document.Status != "queued" || up.Document.Filename != "passwd.png" || up.Document.ContentType != "image/png" {
		t.Errorf("unexpected document: %+v", up.Document)
	}

	r = c.upload(pid, "again.png", pngBytes, nil)
	expect(t, r, http.StatusConflict)
	var dup struct {
		Error struct {
			ExistingID string `json:"existing_id"`
		} `json:"error"`
	}
	r.json(t, &dup)
	if dup.Error.ExistingID != up.Document.ID {
		t.Errorf("duplicate should point to %s, got %s", up.Document.ID, r.body)
	}
	if e.files.count() != 1 {
		t.Errorf("rejected uploads must not leave files behind: %d stored", e.files.count())
	}
}

func TestProcessingReviewAndRecord(t *testing.T) {
	e := newEnv(t)
	c := e.client(t)
	pid := c.register("p@example.com")

	r := c.upload(pid, "blood_test.pdf", pdfBytes(1), nil)
	expect(t, r, http.StatusAccepted)
	var up struct{ Document store.Document }
	r.json(t, &up)
	docID := up.Document.ID
	e.queue.drain(t)

	// Document after processing.
	var got struct{ Document store.Document }
	c.do("GET", "/api/documents/"+docID, nil).json(t, &got)
	d := got.Document
	if d.Status != "needs_review" || d.Stage != "done" || d.DocType != "lab_report" ||
		d.DocDate == nil || *d.DocDate != "2026-01-12" || d.Source == nil || *d.Source != "Apollo Diagnostics" {
		t.Fatalf("unexpected processed document: %+v", d)
	}
	if d.ItemCount != 5 || d.PendingItems != 3 { // 2 malformed/unknown discarded; 2 auto-accepted
		t.Errorf("items=%d pending=%d, want 5/3", d.ItemCount, d.PendingItems)
	}
	if d.OCRText == nil || !strings.Contains(*d.OCRText, "HGB") || len(d.Steps) != 4 {
		t.Errorf("detail fields missing: ocr=%v steps=%d", d.OCRText != nil, len(d.Steps))
	}
	for _, st := range d.Steps {
		if st.Status != "completed" || st.FinishedAt == nil {
			t.Errorf("step %s: %s", st.Stage, st.Status)
		}
	}

	// Only accepted items reach the labs view; the AI's g/L is already normalized.
	var labs struct{ Tests []store.LabTest }
	c.do("GET", "/api/profiles/"+pid+"/labs", nil).json(t, &labs)
	if len(labs.Tests) != 2 {
		t.Fatalf("want 2 accepted lab tests, got %+v", labs.Tests)
	}
	var series store.LabSeries
	c.do("GET", "/api/profiles/"+pid+"/labs/hemoglobin", nil).json(t, &series)
	p0 := series.Results[0]
	if *p0.Value != 13.2 || *p0.UnitOriginal != "g/L" || p0.MeasuredAt != "2026-01-12" {
		t.Errorf("hemoglobin point = %+v (measured_at must fall back to doc date)", p0)
	}
	expect(t, c.do("GET", "/api/profiles/"+pid+"/labs/potassium", nil), http.StatusNotFound)

	// Review queue.
	var queue struct{ Items []store.Item }
	c.do("GET", "/api/profiles/"+pid+"/review", nil).json(t, &queue)
	if len(queue.Items) != 3 || queue.Items[0].Document == nil {
		t.Fatalf("review queue = %+v", queue.Items)
	}
	byName := map[string]store.Item{}
	for _, it := range queue.Items {
		var m map[string]any
		json.Unmarshal(it.Data, &m) //nolint:errcheck
		key, _ := m["test_name_original"].(string)
		if it.Kind == "medication" {
			key = "metformin"
		}
		if it.Status != "needs_review" || len(it.Issues) == 0 && it.Grounded {
			t.Errorf("pending item should carry a reason: %+v", it)
		}
		byName[key] = it
	}
	zinc, bad, met := byName["Serum Zinc"], byName["HbA1c"], byName["metformin"]
	if !strings.Contains(strings.Join(bad.Issues, " "), "flag") {
		t.Errorf("gatekeeper issue missing: %v", bad.Issues)
	}

	// Accepting with invalid corrections → 422 with field errors.
	r = c.do("PATCH", "/api/items/"+zinc.ID, map[string]any{"action": "accept", "data": map[string]any{"test_name_original": "Serum Zinc", "value": 70, "reference_low": 90, "reference_high": 60}})
	expect(t, r, http.StatusUnprocessableEntity)
	if !strings.Contains(string(r.body), "reference_low") {
		t.Errorf("422 should name the field: %s", r.body)
	}
	// Accept with corrections.
	r = c.do("PATCH", "/api/items/"+zinc.ID, map[string]any{"action": "accept", "data": map[string]any{
		"test_name_original": "Serum Zinc", "value": 70, "unit": "ug/dL", "reference_low": 60, "reference_high": 120}})
	expect(t, r, http.StatusOK)
	var acc struct{ Item store.Item }
	r.json(t, &acc)
	if acc.Item.Status != "accepted" || *acc.Item.ReviewedBy != "user" || len(acc.Item.Issues) != 0 {
		t.Errorf("accepted item = %+v", acc.Item)
	}
	expect(t, c.do("GET", "/api/profiles/"+pid+"/labs/raw:serum%20zinc", nil), http.StatusOK)

	// Accept as-is is refused when the stored data is invalid.
	expect(t, c.do("PATCH", "/api/items/"+bad.ID, map[string]any{"action": "accept"}), http.StatusUnprocessableEntity)
	expect(t, c.do("PATCH", "/api/items/"+bad.ID, map[string]any{"action": "reject"}), http.StatusOK)
	expect(t, c.do("PATCH", "/api/items/"+met.ID, map[string]any{"action": "maybe"}), http.StatusUnprocessableEntity)
	expect(t, c.do("PATCH", "/api/items/"+met.ID, map[string]any{"action": "accept"}), http.StatusOK)

	c.do("GET", "/api/documents/"+docID, nil).json(t, &got)
	if got.Document.Status != "completed" || got.Document.PendingItems != 0 {
		t.Errorf("document should be completed once reviewed: %+v", got.Document)
	}

	// Re-rejecting an accepted item removes it from the record.
	expect(t, c.do("PATCH", "/api/items/"+zinc.ID, map[string]any{"action": "reject"}), http.StatusOK)
	expect(t, c.do("GET", "/api/profiles/"+pid+"/labs/raw:serum%20zinc", nil), http.StatusNotFound)

	// Medications, timeline, summary.
	var meds store.MedicationList
	c.do("GET", "/api/profiles/"+pid+"/medications", nil).json(t, &meds)
	if len(meds.Current) != 1 || meds.Current[0].GenericName != "Metformin" || meds.Current[0].Status != "active" {
		t.Errorf("medications = %+v", meds)
	}
	var tl struct{ Events []store.TimelineEvent }
	c.do("GET", "/api/profiles/"+pid+"/timeline", nil).json(t, &tl)
	if len(tl.Events) != 1 || tl.Events[0].Title != "Lab report" || len(tl.Events[0].Highlights) != 3 {
		t.Errorf("timeline = %+v", tl.Events)
	}
	var sum store.Summary
	c.do("GET", "/api/profiles/"+pid+"/summary", nil).json(t, &sum)
	if sum.Counts.Documents != 1 || sum.Counts.PendingReview != 0 || sum.Counts.LabTests != 2 || sum.Counts.ActiveMedications != 1 {
		t.Errorf("summary counts = %+v", sum.Counts)
	}

	// Original file is served safely.
	r = c.do("GET", "/api/documents/"+docID+"/file", nil)
	expect(t, r, http.StatusOK)
	if !bytes.Equal(r.body, pdfBytes(1)) || !strings.Contains(r.header.Get("Content-Security-Policy"), "sandbox") {
		t.Error("file download wrong or missing CSP sandbox")
	}

	// Search.
	var list struct {
		Documents []store.Document
		Total     int
	}
	c.do("GET", "/api/profiles/"+pid+"/documents?q=apollo", nil).json(t, &list)
	if list.Total != 1 {
		t.Errorf("full-text search over OCR/source failed: %+v", list)
	}
	c.do("GET", "/api/profiles/"+pid+"/documents?type=prescription", nil).json(t, &list)
	if list.Total != 0 {
		t.Error("type filter not applied")
	}
	expect(t, c.do("GET", "/api/profiles/"+pid+"/documents?limit=500", nil), http.StatusUnprocessableEntity)

	// Cross-user isolation on documents and items.
	mallory := e.client(t)
	mallory.register("evil@example.com")
	for _, path := range []string{"/api/documents/" + docID, "/api/documents/" + docID + "/file", "/api/documents/" + docID + "/items"} {
		expect(t, mallory.do("GET", path, nil), http.StatusNotFound)
	}
	expect(t, mallory.do("PATCH", "/api/items/"+met.ID, map[string]any{"action": "reject"}), http.StatusNotFound)
	expect(t, mallory.do("POST", "/api/documents/"+docID+"/reprocess", nil), http.StatusNotFound)
	expect(t, mallory.do("DELETE", "/api/documents/"+docID, nil), http.StatusNotFound)

	// Reprocess replaces previous results.
	expect(t, c.do("POST", "/api/documents/"+docID+"/reprocess", nil), http.StatusAccepted)
	expect(t, c.do("POST", "/api/documents/"+docID+"/reprocess", nil), http.StatusConflict) // already queued
	e.queue.drain(t)
	c.do("GET", "/api/documents/"+docID, nil).json(t, &got)
	if got.Document.ItemCount != 5 || len(got.Document.Steps) != 4 || e.ai.extractCalls != 2 {
		t.Errorf("reprocess did not replace results: items=%d steps=%d", got.Document.ItemCount, len(got.Document.Steps))
	}

	// User-set metadata wins over the AI on reprocess.
	expect(t, c.do("PATCH", "/api/documents/"+docID, map[string]any{"doc_date": "2026-01-15", "doc_type": "other"}), http.StatusOK)
	expect(t, c.do("POST", "/api/documents/"+docID+"/reprocess", nil), http.StatusAccepted)
	e.queue.drain(t)
	c.do("GET", "/api/documents/"+docID, nil).json(t, &got)
	if *got.Document.DocDate != "2026-01-15" || got.Document.DocType != "other" || got.Document.DocTypeSource != "user" || got.Document.Steps[1].Status != "skipped" {
		t.Errorf("user metadata overwritten: %+v", got.Document)
	}

	// Delete removes row, record and file.
	expect(t, c.do("DELETE", "/api/documents/"+docID, nil), http.StatusNoContent)
	expect(t, c.do("GET", "/api/documents/"+docID, nil), http.StatusNotFound)
	c.do("GET", "/api/profiles/"+pid+"/labs", nil).json(t, &labs)
	if len(labs.Tests) != 0 || e.files.count() != 0 {
		t.Errorf("delete left data behind: labs=%d files=%d", len(labs.Tests), e.files.count())
	}
}

func TestHealth(t *testing.T) {
	e := newEnv(t)
	r := e.client(t).do("GET", "/api/health", nil)
	expect(t, r, http.StatusOK)
	if r.header.Get("Cache-Control") != "no-store" || r.header.Get("X-Content-Type-Options") != "nosniff" {
		t.Error("security headers missing")
	}
}
