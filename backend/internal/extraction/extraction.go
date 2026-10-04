// Package extraction is the gatekeeper between AI output and the medical
// record. Every payload — whether produced by the AI service or corrected by a
// user on the review screen — is decoded into a typed struct, cleaned and
// validated here before anything is written to the structured tables.
//
// Payload shapes are defined in docs/CONTRACTS.md §1.
package extraction

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

const (
	KindLabResult  = "lab_result"
	KindMedication = "medication"
	KindDiagnosis  = "diagnosis"
	KindAllergy    = "allergy"
	KindEncounter  = "encounter"

	// AutoAcceptThreshold is the minimum confidence for an item to skip human review.
	AutoAcceptThreshold = 0.85

	maxText = 500
)

var Kinds = []string{KindLabResult, KindMedication, KindDiagnosis, KindAllergy, KindEncounter}

func ValidKind(k string) bool {
	for _, x := range Kinds {
		if x == k {
			return true
		}
	}
	return false
}

// Problems maps a field name to what is wrong with it.
type Problems map[string]string

// Issues renders problems as sorted human-readable sentences.
func (p Problems) Issues() []string {
	out := make([]string, 0, len(p))
	for f, msg := range p {
		out = append(out, fmt.Sprintf("%s: %s", f, msg))
	}
	sort.Strings(out)
	return out
}

type LabResult struct {
	TestNameOriginal *string  `json:"test_name_original"`
	CanonicalCode    *string  `json:"canonical_code"`
	CanonicalName    *string  `json:"canonical_name"`
	Value            *float64 `json:"value"`
	ValueText        *string  `json:"value_text"`
	Unit             *string  `json:"unit"`
	ValueOriginal    *float64 `json:"value_original"`
	UnitOriginal     *string  `json:"unit_original"`
	ReferenceLow     *float64 `json:"reference_low"`
	ReferenceHigh    *float64 `json:"reference_high"`
	Flag             *string  `json:"flag"`
	MeasuredAt       *string  `json:"measured_at"`
}

type Medication struct {
	NameOriginal  *string  `json:"name_original"`
	GenericName   *string  `json:"generic_name"`
	BrandName     *string  `json:"brand_name"`
	CanonicalKey  *string  `json:"canonical_key"`
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

type Diagnosis struct {
	Name   *string `json:"name"`
	Status *string `json:"status"`
}

type Allergy struct {
	Substance *string `json:"substance"`
	Reaction  *string `json:"reaction"`
}

type Encounter struct {
	Type     *string `json:"type"`
	Date     *string `json:"date"`
	Facility *string `json:"facility"`
	Doctor   *string `json:"doctor"`
	Notes    *string `json:"notes"`
}

var (
	labFlags       = set("low", "normal", "high")
	medForms       = set("tablet", "capsule", "syrup", "injection", "drops", "ointment", "inhaler", "other")
	frequencyCodes = set("OD", "BD", "TDS", "QID", "HS", "SOS", "STAT", "WEEKLY")
	timings        = set("before_food", "after_food", "with_food", "bedtime")
	diagStatuses   = set("active", "resolved", "suspected")
	encounterTypes = set("visit", "admission", "discharge", "follow_up")
)

// Validate decodes, cleans and validates a payload of the given kind.
// It returns the cleaned payload re-encoded as JSON (unknown fields dropped)
// and any problems found. A non-nil error means the JSON could not be decoded
// at all.
func Validate(kind string, raw json.RawMessage, today time.Time) (any, json.RawMessage, Problems, error) {
	p := Problems{}
	var v any
	switch kind {
	case KindLabResult:
		var x LabResult
		if err := json.Unmarshal(raw, &x); err != nil {
			return nil, nil, nil, fmt.Errorf("malformed lab_result: %w", err)
		}
		x.validate(p, today)
		v = &x
	case KindMedication:
		var x Medication
		if err := json.Unmarshal(raw, &x); err != nil {
			return nil, nil, nil, fmt.Errorf("malformed medication: %w", err)
		}
		x.validate(p)
		v = &x
	case KindDiagnosis:
		var x Diagnosis
		if err := json.Unmarshal(raw, &x); err != nil {
			return nil, nil, nil, fmt.Errorf("malformed diagnosis: %w", err)
		}
		x.Name, x.Status = clean(x.Name), lower(clean(x.Status))
		required(p, "name", x.Name)
		enum(p, "status", x.Status, diagStatuses)
		v = &x
	case KindAllergy:
		var x Allergy
		if err := json.Unmarshal(raw, &x); err != nil {
			return nil, nil, nil, fmt.Errorf("malformed allergy: %w", err)
		}
		x.Substance, x.Reaction = clean(x.Substance), clean(x.Reaction)
		required(p, "substance", x.Substance)
		v = &x
	case KindEncounter:
		var x Encounter
		if err := json.Unmarshal(raw, &x); err != nil {
			return nil, nil, nil, fmt.Errorf("malformed encounter: %w", err)
		}
		x.validate(p, today)
		v = &x
	default:
		return nil, nil, nil, fmt.Errorf("unknown kind %q", kind)
	}
	out, err := json.Marshal(v)
	if err != nil {
		return nil, nil, nil, err
	}
	return v, out, p, nil
}

func (x *LabResult) validate(p Problems, today time.Time) {
	x.TestNameOriginal, x.CanonicalName = clean(x.TestNameOriginal), clean(x.CanonicalName)
	x.CanonicalCode = lower(clean(x.CanonicalCode))
	x.ValueText, x.Unit, x.UnitOriginal = clean(x.ValueText), clean(x.Unit), clean(x.UnitOriginal)
	x.Flag, x.MeasuredAt = lower(clean(x.Flag)), clean(x.MeasuredAt)

	if x.TestNameOriginal == nil && x.CanonicalName == nil {
		p["test_name_original"] = "test name is required"
	}
	if x.Value == nil && x.ValueText == nil {
		p["value"] = "a numeric value or a text result is required"
	}
	finite(p, "value", x.Value)
	finite(p, "value_original", x.ValueOriginal)
	finite(p, "reference_low", x.ReferenceLow)
	finite(p, "reference_high", x.ReferenceHigh)
	if x.ReferenceLow != nil && x.ReferenceHigh != nil && *x.ReferenceLow > *x.ReferenceHigh {
		p["reference_low"] = "reference low is greater than reference high"
	}
	enum(p, "flag", x.Flag, labFlags)
	pastDate(p, "measured_at", x.MeasuredAt, today)
}

func (x *Medication) validate(p Problems) {
	x.NameOriginal, x.GenericName, x.BrandName = clean(x.NameOriginal), clean(x.GenericName), clean(x.BrandName)
	x.CanonicalKey = lower(clean(x.CanonicalKey))
	x.Form, x.DoseUnit = lower(clean(x.Form)), clean(x.DoseUnit)
	x.FrequencyCode = upper(clean(x.FrequencyCode))
	x.Schedule, x.Timing, x.Instructions = clean(x.Schedule), lower(clean(x.Timing)), clean(x.Instructions)

	if x.GenericName == nil && x.NameOriginal == nil {
		p["generic_name"] = "medicine name is required"
	}
	if x.DoseValue != nil && (math.IsNaN(*x.DoseValue) || *x.DoseValue <= 0 || *x.DoseValue > 100_000) {
		p["dose_value"] = "dose must be a positive number"
	}
	enum(p, "form", x.Form, medForms)
	enum(p, "frequency_code", x.FrequencyCode, frequencyCodes)
	enum(p, "timing", x.Timing, timings)
	if x.TimesPerDay != nil && (*x.TimesPerDay < 0 || *x.TimesPerDay > 24) {
		p["times_per_day"] = "must be between 0 and 24"
	}
	if x.DurationDays != nil && (*x.DurationDays < 0 || *x.DurationDays > 3650) {
		p["duration_days"] = "must be between 0 and 3650"
	}
}

func (x *Encounter) validate(p Problems, today time.Time) {
	x.Type, x.Date = lower(clean(x.Type)), clean(x.Date)
	x.Facility, x.Doctor, x.Notes = clean(x.Facility), clean(x.Doctor), clean(x.Notes)
	required(p, "type", x.Type)
	enum(p, "type", x.Type, encounterTypes)
	if d, ok := date(p, "date", x.Date); ok {
		// Follow-ups are legitimately in the future, but not decades away.
		if d.After(today.AddDate(5, 0, 0)) {
			p["date"] = "date is too far in the future"
		}
	}
}

// ---- derived identifiers used when materializing ---------------------------

// LabCode is the grouping key for trends: the canonical code, or a "raw:"
// key for tests the normalizer did not recognize.
func (x *LabResult) LabCode() string {
	if x.CanonicalCode != nil {
		return *x.CanonicalCode
	}
	return "raw:" + strings.ToLower(deref(x.TestNameOriginal))
}

func (x *LabResult) DisplayName() string {
	if x.CanonicalName != nil {
		return *x.CanonicalName
	}
	return deref(x.TestNameOriginal)
}

func (x *Medication) Key() string {
	if x.CanonicalKey != nil {
		return *x.CanonicalKey
	}
	return strings.ToLower(x.Name())
}

func (x *Medication) Name() string {
	if x.GenericName != nil {
		return *x.GenericName
	}
	return deref(x.NameOriginal)
}

// ---- helpers ---------------------------------------------------------------

func set(vals ...string) map[string]bool {
	m := make(map[string]bool, len(vals))
	for _, v := range vals {
		m[v] = true
	}
	return m
}

// clean trims whitespace, caps length and turns empty strings into nil, so
// "unknown" is always represented as null.
func clean(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil
	}
	if r := []rune(t); len(r) > maxText {
		t = string(r[:maxText])
	}
	return &t
}

func lower(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.ToLower(*s)
	return &t
}

func upper(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.ToUpper(*s)
	return &t
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func required(p Problems, field string, v *string) {
	if v == nil {
		p[field] = "is required"
	}
}

func enum(p Problems, field string, v *string, allowed map[string]bool) {
	if v != nil && !allowed[*v] {
		p[field] = fmt.Sprintf("%q is not an allowed value", *v)
	}
}

func finite(p Problems, field string, v *float64) {
	if v != nil && (math.IsNaN(*v) || math.IsInf(*v, 0) || math.Abs(*v) > 1e9) {
		p[field] = "must be a finite number"
	}
}

func date(p Problems, field string, v *string) (time.Time, bool) {
	if v == nil {
		return time.Time{}, false
	}
	d, err := time.Parse(time.DateOnly, *v)
	if err != nil {
		p[field] = "must be a date in YYYY-MM-DD format"
		return time.Time{}, false
	}
	if d.Year() < 1900 {
		p[field] = "date is implausibly old"
		return time.Time{}, false
	}
	return d, true
}

// ValidPastDate reports whether s is a YYYY-MM-DD date that is plausible and
// not in the future.
func ValidPastDate(s string, today time.Time) bool {
	p := Problems{}
	pastDate(p, "date", &s, today)
	return len(p) == 0
}

// pastDate rejects dates more than a day in the future (time-zone slack).
func pastDate(p Problems, field string, v *string, today time.Time) {
	if d, ok := date(p, field, v); ok && d.After(today.AddDate(0, 0, 1)) {
		p[field] = "date is in the future"
	}
}
