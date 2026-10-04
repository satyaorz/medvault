package store

import (
	"context"
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- Labs -------------------------------------------------------------------

type LabPoint struct {
	ID               string   `json:"id"`
	Value            *float64 `json:"value"`
	ValueText        *string  `json:"value_text"`
	Unit             *string  `json:"unit"`
	ReferenceLow     *float64 `json:"reference_low"`
	ReferenceHigh    *float64 `json:"reference_high"`
	Flag             *string  `json:"flag"`
	MeasuredAt       string   `json:"measured_at"`
	DocumentID       string   `json:"document_id"`
	TestNameOriginal *string  `json:"test_name_original"`
	ValueOriginal    *float64 `json:"value_original"`
	UnitOriginal     *string  `json:"unit_original"`

	code, name string
}

type LabTest struct {
	Code     string    `json:"code"`
	Name     string    `json:"name"`
	Unit     *string   `json:"unit"`
	Count    int       `json:"count"`
	Latest   LabPoint  `json:"latest"`
	Previous *LabPoint `json:"previous"`
	Trend    *string   `json:"trend"`
}

type LabSeries struct {
	Test    LabTestRef `json:"test"`
	Results []LabPoint `json:"results"`
}

type LabTestRef struct {
	Code string  `json:"code"`
	Name string  `json:"name"`
	Unit *string `json:"unit"`
}

func (s *Store) labPoints(ctx context.Context, profileID, code string) ([]LabPoint, error) {
	rows, err := s.pool.Query(ctx, `SELECT lr.id::text, lr.code, lr.name, lr.value, lr.value_text, lr.unit,
			lr.reference_low, lr.reference_high, lr.flag,
			to_char(COALESCE(lr.measured_at, `+effDate+`), 'YYYY-MM-DD') AS m,
			lr.document_id::text, lr.test_name_original, lr.value_original, lr.unit_original
		FROM lab_results lr JOIN documents d ON d.id = lr.document_id
		WHERE lr.profile_id = $1 AND ($2 = '' OR lr.code = $2)
		ORDER BY lr.code, m, d.created_at`, profileID, code)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (LabPoint, error) {
		var p LabPoint
		err := r.Scan(&p.ID, &p.code, &p.name, &p.Value, &p.ValueText, &p.Unit, &p.ReferenceLow, &p.ReferenceHigh,
			&p.Flag, &p.MeasuredAt, &p.DocumentID, &p.TestNameOriginal, &p.ValueOriginal, &p.UnitOriginal)
		return p, err
	})
}

// Labs lists every test with its latest value, newest-measured first.
func (s *Store) Labs(ctx context.Context, userID, profileID string) ([]LabTest, error) {
	if err := s.CheckProfile(ctx, userID, profileID); err != nil {
		return nil, err
	}
	points, err := s.labPoints(ctx, profileID, "")
	if err != nil {
		return nil, err
	}
	return groupLabs(points), nil
}

// groupLabs expects points sorted by code then date ascending.
func groupLabs(points []LabPoint) []LabTest {
	tests := []LabTest{}
	for i := 0; i < len(points); {
		j := i
		for j < len(points) && points[j].code == points[i].code {
			j++
		}
		series := points[i:j]
		latest := series[len(series)-1]
		t := LabTest{Code: latest.code, Name: latest.name, Unit: latest.Unit, Count: len(series), Latest: latest}
		if len(series) > 1 {
			prev := series[len(series)-2]
			t.Previous = &prev
			t.Trend = trend(prev.Value, latest.Value)
		}
		tests = append(tests, t)
		i = j
	}
	sort.SliceStable(tests, func(a, b int) bool {
		if tests[a].Latest.MeasuredAt != tests[b].Latest.MeasuredAt {
			return tests[a].Latest.MeasuredAt > tests[b].Latest.MeasuredAt
		}
		return tests[a].Name < tests[b].Name
	})
	return tests
}

// trend compares two values with a 2% dead band so rounding noise reads "flat".
func trend(prev, cur *float64) *string {
	if prev == nil || cur == nil {
		return nil
	}
	diff := *cur - *prev
	scale := math.Max(math.Abs(*prev), 1e-9)
	t := "flat"
	switch {
	case diff/scale > 0.02:
		t = "up"
	case diff/scale < -0.02:
		t = "down"
	}
	return &t
}

func (s *Store) LabSeries(ctx context.Context, userID, profileID, code string) (*LabSeries, error) {
	if err := s.CheckProfile(ctx, userID, profileID); err != nil {
		return nil, err
	}
	points, err := s.labPoints(ctx, profileID, code)
	if err != nil {
		return nil, err
	}
	if len(points) == 0 {
		return nil, ErrNotFound
	}
	last := points[len(points)-1]
	return &LabSeries{Test: LabTestRef{Code: code, Name: last.name, Unit: last.Unit}, Results: points}, nil
}

// ---- Medications --------------------------------------------------------------

type MedicationEvent struct {
	ID            string   `json:"id"`
	DocumentID    string   `json:"document_id"`
	PrescribedAt  string   `json:"prescribed_at"`
	BrandName     *string  `json:"brand_name"`
	NameOriginal  *string  `json:"name_original"`
	Form          *string  `json:"form"`
	DoseValue     *float64 `json:"dose_value"`
	DoseUnit      *string  `json:"dose_unit"`
	FrequencyCode *string  `json:"frequency_code"`
	TimesPerDay   *int     `json:"times_per_day"`
	Schedule      *string  `json:"schedule"`
	Timing        *string  `json:"timing"`
	DurationDays  *int     `json:"duration_days"`
	Instructions  *string  `json:"instructions"`
}

type Medication struct {
	ID           string            `json:"id"`
	CanonicalKey string            `json:"canonical_key"`
	GenericName  string            `json:"generic_name"`
	Status       string            `json:"status"`
	Latest       MedicationEvent   `json:"latest"`
	History      []MedicationEvent `json:"history"`
}

type MedicationList struct {
	Current []Medication `json:"current"`
	Past    []Medication `json:"past"`
}

// MedEventRow is one prescription mention with the context needed to decide status.
type MedEventRow struct {
	MedicationID, CanonicalKey, GenericName string
	DocType                                 string
	DocCreatedAt                            time.Time
	Event                                   MedicationEvent
}

func (s *Store) Medications(ctx context.Context, userID, profileID string) (*MedicationList, error) {
	if err := s.CheckProfile(ctx, userID, profileID); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT m.id::text, m.canonical_key, m.generic_name, d.doc_type, d.created_at,
			e.id::text, e.document_id::text, to_char(`+effDate+`, 'YYYY-MM-DD'), e.brand_name, e.name_original, e.form,
			e.dose_value, e.dose_unit, e.frequency_code, e.times_per_day, e.schedule, e.timing, e.duration_days, e.instructions
		FROM medication_events e
		JOIN medications m ON m.id = e.medication_id
		JOIN documents d ON d.id = e.document_id
		WHERE e.profile_id = $1`, profileID)
	if err != nil {
		return nil, err
	}
	events, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (MedEventRow, error) {
		var m MedEventRow
		e := &m.Event
		err := r.Scan(&m.MedicationID, &m.CanonicalKey, &m.GenericName, &m.DocType, &m.DocCreatedAt,
			&e.ID, &e.DocumentID, &e.PrescribedAt, &e.BrandName, &e.NameOriginal, &e.Form,
			&e.DoseValue, &e.DoseUnit, &e.FrequencyCode, &e.TimesPerDay, &e.Schedule, &e.Timing, &e.DurationDays, &e.Instructions)
		return m, err
	})
	if err != nil {
		return nil, err
	}
	list := BuildMedications(events, s.Today())
	return &list, nil
}

// BuildMedications applies the Phase 2 status rules (docs/CONTRACTS.md §3):
// a medication is current if it appears in the most recent prescription-like
// document and its course has not ended; otherwise it is past, either
// "course_completed" or "not_in_latest". Absence is deliberately not called
// "discontinued" — the UI asks the user to confirm.
func BuildMedications(events []MedEventRow, today time.Time) MedicationList {
	newer := func(a, b MedEventRow) bool {
		if a.Event.PrescribedAt != b.Event.PrescribedAt {
			return a.Event.PrescribedAt > b.Event.PrescribedAt
		}
		if !a.DocCreatedAt.Equal(b.DocCreatedAt) {
			return a.DocCreatedAt.After(b.DocCreatedAt)
		}
		return a.Event.ID > b.Event.ID
	}
	sort.SliceStable(events, func(i, j int) bool { return newer(events[i], events[j]) })

	// The latest prescription-like document; fall back to any document.
	latestDoc := ""
	for _, e := range events {
		if e.DocType == "prescription" || e.DocType == "discharge_summary" {
			latestDoc = e.Event.DocumentID
			break
		}
	}
	if latestDoc == "" && len(events) > 0 {
		latestDoc = events[0].Event.DocumentID
	}

	byMed := map[string]*Medication{}
	order := []string{}
	for _, e := range events { // newest first → first seen is latest
		m, ok := byMed[e.MedicationID]
		if !ok {
			m = &Medication{ID: e.MedicationID, CanonicalKey: e.CanonicalKey, GenericName: e.GenericName, Latest: e.Event}
			byMed[e.MedicationID] = m
			order = append(order, e.MedicationID)
		}
		m.History = append(m.History, e.Event)
	}

	list := MedicationList{Current: []Medication{}, Past: []Medication{}}
	for _, id := range order {
		m := byMed[id]
		inLatest := false
		for _, h := range m.History {
			if h.DocumentID == latestDoc {
				inLatest = true
				break
			}
		}
		switch {
		case courseEnded(m.Latest, today):
			m.Status = "course_completed"
		case inLatest:
			m.Status = "active"
		default:
			m.Status = "not_in_latest"
		}
		if m.Status == "active" {
			list.Current = append(list.Current, *m)
		} else {
			list.Past = append(list.Past, *m)
		}
	}
	sort.SliceStable(list.Current, func(i, j int) bool { return list.Current[i].GenericName < list.Current[j].GenericName })
	return list
}

func courseEnded(e MedicationEvent, today time.Time) bool {
	if e.DurationDays == nil || *e.DurationDays <= 0 {
		return false
	}
	start, err := time.Parse(time.DateOnly, e.PrescribedAt)
	if err != nil {
		return false
	}
	return start.AddDate(0, 0, *e.DurationDays).Before(today)
}

// ---- Timeline ---------------------------------------------------------------

type Highlight struct {
	Kind  string  `json:"kind"`
	Label string  `json:"label"`
	Value string  `json:"value"`
	Flag  *string `json:"flag,omitempty"`
}

type TimelineEvent struct {
	ID         string      `json:"id"`
	Date       string      `json:"date"`
	Type       string      `json:"type"`
	Title      string      `json:"title"`
	Subtitle   *string     `json:"subtitle"`
	DocumentID string      `json:"document_id"`
	Status     *string     `json:"status"`
	Highlights []Highlight `json:"highlights"`
}

var docTypeTitles = map[string]string{
	"lab_report":        "Lab report",
	"prescription":      "Prescription",
	"discharge_summary": "Discharge summary",
}

func (s *Store) Timeline(ctx context.Context, userID, profileID string) ([]TimelineEvent, error) {
	if err := s.CheckProfile(ctx, userID, profileID); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT d.id::text, to_char(`+effDate+`, 'YYYY-MM-DD'), d.doc_type, d.title, d.filename, d.source, d.status
		FROM documents d WHERE d.profile_id = $1 AND d.status IN ('completed', 'needs_review')
		ORDER BY `+effDate+` DESC, d.created_at DESC`, profileID)
	if err != nil {
		return nil, err
	}
	events, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (TimelineEvent, error) {
		var e TimelineEvent
		var title *string
		var filename, status string
		if err := r.Scan(&e.DocumentID, &e.Date, &e.Type, &title, &filename, &e.Subtitle, &status); err != nil {
			return e, err
		}
		e.ID, e.Status, e.Highlights = "doc:"+e.DocumentID, &status, []Highlight{}
		switch {
		case title != nil:
			e.Title = *title
		case docTypeTitles[e.Type] != "":
			e.Title = docTypeTitles[e.Type]
		default:
			e.Title = filename
		}
		return e, nil
	})
	if err != nil {
		return nil, err
	}

	// Attach highlights from accepted items.
	itemRows, err := s.pool.Query(ctx, `SELECT document_id::text, kind, data FROM extracted_items
		WHERE profile_id = $1 AND status = 'accepted' ORDER BY document_id, position`, profileID)
	if err != nil {
		return nil, err
	}
	byDoc := map[string][]Highlight{}
	for itemRows.Next() {
		var docID, kind string
		var data json.RawMessage
		if err := itemRows.Scan(&docID, &kind, &data); err != nil {
			itemRows.Close()
			return nil, err
		}
		if h, ok := highlight(kind, data); ok {
			byDoc[docID] = append(byDoc[docID], h)
		}
	}
	itemRows.Close()
	if err := itemRows.Err(); err != nil {
		return nil, err
	}
	for i := range events {
		if h := byDoc[events[i].DocumentID]; h != nil {
			events[i].Highlights = h
		}
	}

	// Upcoming follow-ups become their own events.
	upcoming, err := s.upcoming(ctx, profileID, 50)
	if err != nil {
		return nil, err
	}
	for _, u := range upcoming {
		sub := u.Doctor
		if sub == nil {
			sub = u.Facility
		}
		hl := []Highlight{}
		if u.Notes != nil {
			hl = append(hl, Highlight{Kind: "encounter", Label: "Notes", Value: *u.Notes})
		}
		events = append(events, TimelineEvent{ID: "enc:" + u.ID, Date: u.Date, Type: "follow_up", Title: "Follow-up",
			Subtitle: sub, DocumentID: u.DocumentID, Highlights: hl})
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].Date > events[j].Date })
	return events, nil
}

func highlight(kind string, data json.RawMessage) (Highlight, bool) {
	var m map[string]any
	if json.Unmarshal(data, &m) != nil {
		return Highlight{}, false
	}
	str := func(k string) string { s, _ := m[k].(string); return s }
	num := func(k string) string {
		if f, ok := m[k].(float64); ok {
			return strconv.FormatFloat(f, 'f', -1, 64)
		}
		return ""
	}
	first := func(vals ...string) string {
		for _, v := range vals {
			if v != "" {
				return v
			}
		}
		return ""
	}
	join := func(sep string, parts ...string) string {
		out := parts[:0:0]
		for _, p := range parts {
			if p != "" {
				out = append(out, p)
			}
		}
		return strings.Join(out, sep)
	}

	h := Highlight{Kind: kind}
	switch kind {
	case "lab_result":
		h.Label = first(str("canonical_name"), str("test_name_original"))
		h.Value = first(join(" ", num("value"), str("unit")), str("value_text"))
		if f := str("flag"); f != "" {
			h.Flag = &f
		}
	case "medication":
		h.Label = first(str("generic_name"), str("name_original"))
		h.Value = join(" · ", join(" ", num("dose_value"), str("dose_unit")), str("frequency_code"))
	case "diagnosis":
		h.Label, h.Value = str("name"), str("status")
	case "allergy":
		h.Label, h.Value = "Allergy: "+str("substance"), str("reaction")
	case "encounter":
		switch str("type") {
		case "admission":
			h.Label = "Admitted"
		case "discharge":
			h.Label = "Discharged"
		default:
			return Highlight{}, false // visits are the document itself; follow-ups get their own event
		}
		h.Value = first(str("date"), str("facility"))
	default:
		return Highlight{}, false
	}
	return h, h.Label != ""
}

// ---- Summary ------------------------------------------------------------------

type Upcoming struct {
	ID         string  `json:"-"`
	Type       string  `json:"type"`
	Date       string  `json:"date"`
	Doctor     *string `json:"doctor"`
	Facility   *string `json:"facility"`
	Notes      *string `json:"notes"`
	DocumentID string  `json:"document_id"`
}

func (s *Store) upcoming(ctx context.Context, profileID string, limit int) ([]Upcoming, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text, type, to_char(date, 'YYYY-MM-DD'), doctor, facility, notes, document_id::text
		FROM encounters WHERE profile_id = $1 AND type = 'follow_up' AND date >= $2::date
		ORDER BY date LIMIT $3`, profileID, s.Today().Format(time.DateOnly), limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Upcoming, error) {
		var u Upcoming
		err := r.Scan(&u.ID, &u.Type, &u.Date, &u.Doctor, &u.Facility, &u.Notes, &u.DocumentID)
		return u, err
	})
}

type Counts struct {
	Documents         int `json:"documents"`
	Processing        int `json:"processing"`
	PendingReview     int `json:"pending_review"`
	ActiveMedications int `json:"active_medications"`
	LabTests          int `json:"lab_tests"`
}

type Summary struct {
	Profile         *Profile   `json:"profile"`
	Counts          Counts     `json:"counts"`
	RecentDocuments []Document `json:"recent_documents"`
	RecentLabs      []LabTest  `json:"recent_labs"`
	Upcoming        []Upcoming `json:"upcoming"`
}

func (s *Store) Summary(ctx context.Context, userID, profileID string) (*Summary, error) {
	p, err := s.GetProfile(ctx, userID, profileID)
	if err != nil {
		return nil, err
	}
	sum := &Summary{Profile: p}
	err = s.pool.QueryRow(ctx, `SELECT
			(SELECT count(*) FROM documents WHERE profile_id = $1),
			(SELECT count(*) FROM documents WHERE profile_id = $1 AND status IN ('queued', 'processing')),
			(SELECT count(*) FROM extracted_items WHERE profile_id = $1 AND status = 'needs_review')`, profileID).
		Scan(&sum.Counts.Documents, &sum.Counts.Processing, &sum.Counts.PendingReview)
	if err != nil {
		return nil, err
	}
	if sum.RecentDocuments, _, err = s.ListDocuments(ctx, userID, profileID, DocumentFilter{Limit: 5}); err != nil {
		return nil, err
	}
	labs, err := s.Labs(ctx, userID, profileID)
	if err != nil {
		return nil, err
	}
	sum.Counts.LabTests = len(labs)
	sum.RecentLabs = labs[:min(6, len(labs))]
	meds, err := s.Medications(ctx, userID, profileID)
	if err != nil {
		return nil, err
	}
	sum.Counts.ActiveMedications = len(meds.Current)
	if sum.Upcoming, err = s.upcoming(ctx, profileID, 5); err != nil {
		return nil, err
	}
	return sum, nil
}
