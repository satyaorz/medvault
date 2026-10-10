package store

import (
	"encoding/json"
	"testing"
	"time"
)

func ptr[T any](v T) *T { return &v }

func TestBuildMedications(t *testing.T) {
	today := time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	ev := func(med, doc, docType, date string, dur *int, dose float64) MedEventRow {
		return MedEventRow{
			MedicationID: med, CanonicalKey: med, GenericName: med, DocType: docType, DocCreatedAt: base,
			Event: MedicationEvent{ID: med + doc, DocumentID: doc, PrescribedAt: date, DurationDays: dur, DoseValue: &dose},
		}
	}
	events := []MedEventRow{
		// March prescription
		ev("amlodipine", "rx1", "prescription", "2026-03-03", nil, 5),
		ev("atorvastatin", "rx1", "prescription", "2026-03-03", nil, 10),
		// August prescription: amlodipine increased, atorvastatin gone, rosuvastatin new
		ev("amlodipine", "rx2", "prescription", "2026-08-15", nil, 10),
		ev("rosuvastatin", "rx2", "prescription", "2026-08-15", nil, 10),
		ev("amoxicillin+clavulanate", "rx2", "prescription", "2026-08-15", ptr(5), 625),
		// Maintenance therapy written as "x 30 days" stays active while in the latest prescription.
		ev("metformin", "rx2", "prescription", "2026-08-15", ptr(30), 500),
		// A long course absent from the latest prescription is flagged, not "completed".
		ev("cholecalciferol", "rx1", "prescription", "2026-03-03", ptr(56), 60000),
		// A medication merely mentioned in a later lab report must not define "latest prescription".
		ev("vitamin d3", "lab1", "lab_report", "2026-09-02", nil, 60000),
	}
	got := BuildMedications(events, today)

	status := map[string]string{}
	for _, m := range append(got.Current, got.Past...) {
		status[m.CanonicalKey] = m.Status
	}
	want := map[string]string{
		"amlodipine":              "active",
		"rosuvastatin":            "active",
		"atorvastatin":            "not_in_latest",
		"amoxicillin+clavulanate": "course_completed",
		"vitamin d3":              "not_in_latest",
		"metformin":               "active",
		"cholecalciferol":         "not_in_latest",
	}
	for k, w := range want {
		if status[k] != w {
			t.Errorf("%s: status %q, want %q", k, status[k], w)
		}
	}
	if len(got.Current) != 3 || got.Current[0].GenericName != "amlodipine" {
		t.Fatalf("current = %+v", got.Current)
	}
	aml := got.Current[0]
	if *aml.Latest.DoseValue != 10 || len(aml.History) != 2 || aml.History[1].PrescribedAt != "2026-03-03" {
		t.Errorf("amlodipine latest/history wrong: %+v", aml)
	}
}

func TestBuildMedicationsEmpty(t *testing.T) {
	got := BuildMedications(nil, time.Now())
	if got.Current == nil || got.Past == nil || len(got.Current)+len(got.Past) != 0 {
		t.Fatalf("want empty non-nil slices, got %+v", got)
	}
}

func TestTrend(t *testing.T) {
	cases := []struct {
		prev, cur *float64
		want      string
	}{
		{ptr(6.2), ptr(6.5), "up"},
		{ptr(14.2), ptr(12.4), "down"},
		{ptr(100.0), ptr(101.0), "flat"},
		{ptr(0.0), ptr(0.5), "up"},
		{nil, ptr(1.0), ""},
	}
	for _, c := range cases {
		got := trend(c.prev, c.cur)
		if (got == nil && c.want != "") || (got != nil && *got != c.want) {
			t.Errorf("trend(%v,%v) = %v, want %q", c.prev, c.cur, got, c.want)
		}
	}
}

func TestGroupLabs(t *testing.T) {
	pt := func(code, date string, v float64) LabPoint {
		return LabPoint{code: code, name: code, MeasuredAt: date, Value: &v}
	}
	tests := groupLabs([]LabPoint{
		pt("hba1c", "2026-01-12", 5.8), pt("hba1c", "2026-05-21", 6.2), pt("hba1c", "2026-09-02", 6.5),
		pt("hemoglobin", "2026-06-01", 13.0),
	})
	if len(tests) != 2 || tests[0].Code != "hba1c" {
		t.Fatalf("want hba1c first (most recent), got %+v", tests)
	}
	h := tests[0]
	if h.Count != 3 || *h.Latest.Value != 6.5 || *h.Previous.Value != 6.2 || *h.Trend != "up" {
		t.Errorf("bad hba1c summary: %+v", h)
	}
	if tests[1].Previous != nil || tests[1].Trend != nil {
		t.Error("single point must have no previous/trend")
	}
}

func TestHighlight(t *testing.T) {
	h, ok := highlight("lab_result", json.RawMessage(`{"canonical_name":"HbA1c","value":6.5,"unit":"%","flag":"high"}`))
	if !ok || h.Label != "HbA1c" || h.Value != "6.5 %" || *h.Flag != "high" {
		t.Errorf("lab highlight = %+v", h)
	}
	h, ok = highlight("medication", json.RawMessage(`{"generic_name":"Amlodipine","dose_value":10,"dose_unit":"mg","frequency_code":"OD"}`))
	if !ok || h.Value != "10 mg · OD" {
		t.Errorf("med highlight = %+v", h)
	}
	h, ok = highlight("medication", json.RawMessage(`{"name_original":"Tab X","frequency_code":"SOS"}`))
	if !ok || h.Label != "Tab X" || h.Value != "SOS" {
		t.Errorf("partial med highlight = %+v", h)
	}
	if _, ok := highlight("encounter", json.RawMessage(`{"type":"visit"}`)); ok {
		t.Error("visits should not be highlights")
	}
}
