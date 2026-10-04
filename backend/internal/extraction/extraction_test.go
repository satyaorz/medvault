package extraction

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

var today = time.Date(2026, 10, 4, 0, 0, 0, 0, time.UTC)

func TestValidateLabResult(t *testing.T) {
	tests := []struct {
		name      string
		json      string
		wantField string // "" = no problems
	}{
		{"valid", `{"test_name_original":"HGB","canonical_code":"hemoglobin","canonical_name":"Hemoglobin","value":13.2,"unit":"g/dL","reference_low":13,"reference_high":17,"flag":"normal","measured_at":"2026-01-12"}`, ""},
		{"text result ok", `{"test_name_original":"HBsAg","value_text":"Non reactive"}`, ""},
		{"missing name", `{"value":1}`, "test_name_original"},
		{"blank name treated as missing", `{"test_name_original":"   ","value":1}`, "test_name_original"},
		{"missing value", `{"test_name_original":"Hb"}`, "value"},
		{"inverted range", `{"test_name_original":"Hb","value":1,"reference_low":20,"reference_high":10}`, "reference_low"},
		{"bad flag", `{"test_name_original":"Hb","value":1,"flag":"critical"}`, "flag"},
		{"future date", `{"test_name_original":"Hb","value":1,"measured_at":"2027-01-01"}`, "measured_at"},
		{"bad date", `{"test_name_original":"Hb","value":1,"measured_at":"12/01/2026"}`, "measured_at"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, p, err := Validate(KindLabResult, json.RawMessage(tt.json), today)
			if err != nil {
				t.Fatal(err)
			}
			if tt.wantField == "" && len(p) != 0 {
				t.Fatalf("unexpected problems: %v", p)
			}
			if tt.wantField != "" {
				if _, ok := p[tt.wantField]; !ok {
					t.Fatalf("want problem on %q, got %v", tt.wantField, p)
				}
			}
		})
	}
}

func TestValidateCleansAndDropsUnknownFields(t *testing.T) {
	v, out, p, err := Validate(KindMedication, json.RawMessage(
		`{"name_original":" TAB. Pan 40 ","generic_name":"Pantoprazole","canonical_key":"Pantoprazole",
		  "frequency_code":"od","timing":"Before_Food","brand_name":"","injected":"x"}`), today)
	if err != nil || len(p) != 0 {
		t.Fatalf("err=%v problems=%v", err, p)
	}
	m := v.(*Medication)
	if *m.NameOriginal != "TAB. Pan 40" || *m.FrequencyCode != "OD" || *m.Timing != "before_food" || *m.CanonicalKey != "pantoprazole" {
		t.Errorf("not cleaned: %+v", m)
	}
	if m.BrandName != nil {
		t.Error("empty string should become null")
	}
	if strings.Contains(string(out), "injected") {
		t.Error("unknown field survived re-encoding")
	}
}

func TestValidateMedicationProblems(t *testing.T) {
	_, _, p, _ := Validate(KindMedication, json.RawMessage(
		`{"generic_name":"X","dose_value":-5,"frequency_code":"EVERY_HOUR","form":"pill","duration_days":99999}`), today)
	for _, f := range []string{"dose_value", "frequency_code", "form", "duration_days"} {
		if _, ok := p[f]; !ok {
			t.Errorf("expected problem on %s, got %v", f, p)
		}
	}
}

func TestValidateEncounterAllowsFutureFollowUp(t *testing.T) {
	_, _, p, _ := Validate(KindEncounter, json.RawMessage(`{"type":"follow_up","date":"2026-11-15"}`), today)
	if len(p) != 0 {
		t.Fatalf("follow-up next month should be valid: %v", p)
	}
	_, _, p, _ = Validate(KindEncounter, json.RawMessage(`{"type":"follow_up","date":"2040-01-01"}`), today)
	if _, ok := p["date"]; !ok {
		t.Fatal("date 14 years ahead should be rejected")
	}
	_, _, p, _ = Validate(KindEncounter, json.RawMessage(`{"type":"surgery"}`), today)
	if _, ok := p["type"]; !ok {
		t.Fatal("unknown encounter type should be rejected")
	}
}

func TestValidateMalformedAndUnknownKind(t *testing.T) {
	if _, _, _, err := Validate(KindLabResult, json.RawMessage(`{"value":"high"}`), today); err == nil {
		t.Error("wrong JSON type should error")
	}
	if _, _, _, err := Validate("vital_sign", json.RawMessage(`{}`), today); err == nil {
		t.Error("unknown kind should error")
	}
}

func TestDerivedKeys(t *testing.T) {
	name := "Serum Zinc"
	l := LabResult{TestNameOriginal: &name}
	if l.LabCode() != "raw:serum zinc" || l.DisplayName() != "Serum Zinc" {
		t.Errorf("unexpected raw key %q / %q", l.LabCode(), l.DisplayName())
	}
	orig := "Tab Foo 10"
	m := Medication{NameOriginal: &orig}
	if m.Key() != "tab foo 10" || m.Name() != "Tab Foo 10" {
		t.Errorf("unexpected med key %q", m.Key())
	}
}
