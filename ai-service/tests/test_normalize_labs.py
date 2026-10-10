import pytest

from app.normalize.labs import catalog, compute_flag, normalize_lab, parse_reference_range
from app.normalize.units import unit_key


@pytest.mark.parametrize(
    "name, code",
    [
        ("Hb", "hemoglobin"), ("HGB", "hemoglobin"), ("Haemoglobin", "hemoglobin"),
        ("S. Creatinine", "creatinine"), ("Serum Creatinine", "creatinine"),
        ("SGPT", "alt"), ("SGPT (ALT)", "alt"), ("FBS", "glucose_fasting"), ("Glucose (Fasting)", "glucose_fasting"),
        ("PPBS", "glucose_pp"), ("Glycated Haemoglobin (HbA1c)", "hba1c"), ("25-OH Vitamin D", "vitamin_d"),
        ("Vit D3", "vitamin_d"), ("TSH (Ultrasensitive)", "tsh"), ("Total Leucocyte Count", "wbc"),
        ("LDL Cholesterol (Direct)", "ldl"), ("T3", "t3"), ("Na+", "sodium"),
    ],
)
def test_alias_lookup_exact(name, code):
    test, how = catalog().lookup(name)
    assert test is not None and test.code == code
    assert how == "exact"


@pytest.mark.parametrize("name, code", [("Haemoglobln", "hemoglobin"), ("HbAlc", "hba1c"), ("Creatinlne", "creatinine")])
def test_alias_lookup_tolerates_ocr_errors_but_marks_them_fuzzy(name, code):
    test, how = catalog().lookup(name)
    assert test.code == code
    assert how == "fuzzy"


def test_short_aliases_never_fuzzy_match():
    test, _ = catalog().lookup("Kx")
    assert test is None


@pytest.mark.parametrize(
    "raw, key",
    [("mg/dl", "mg/dl"), ("mg%", "mg/dl"), ("gm/dL", "g/dl"), ("/cumm", "/ul"), ("cells/cu.mm", "/ul"),
     ("lakhs/cumm", "lakh/ul"), ("x10³/µL", "10^3/ul"), ("µmol/L", "umol/l"), ("mIU/L", "uiu/ml"),
     ("plU/mL", "uiu/ml"), ("IU/L", "u/l"), (None, None), ("", None)],
)
def test_unit_key(raw, key):
    assert unit_key(raw) == key


@pytest.mark.parametrize(
    "name, value, unit, expected",
    [
        ("HGB", "132", "g/L", 13.2),                      # g/L → g/dL
        ("Haemoglobin", "13.2", "gm%", 13.2),
        ("Glucose (Fasting)", "6.3", "mmol/L", 113.5),     # ×18.016
        ("S. Creatinine", "88.4", "µmol/L", 1.0),          # ÷88.42
        ("HbA1c", "48", "mmol/mol", 6.54),                 # IFCC → NGSP
        ("Platelet Count", "2.5", "lakhs/cumm", 250.0),
        ("Platelets", "250000", "/cumm", 250.0),
        ("Total WBC Count", "7,500", "cells/cumm", 7.5),
        ("25-OH Vitamin D", "50", "nmol/L", 20.03),
        ("Total Cholesterol", "5.2", "mmol/L", 201.1),
        ("TSH", "2.1", "mIU/L", 2.1),
    ],
)
def test_unit_conversion_to_canonical(name, value, unit, expected):
    result = normalize_lab(name, value, unit)
    assert result.data["value"] == pytest.approx(expected, rel=0.01)
    assert result.issues == []
    assert result.data["value_original"] == pytest.approx(float(value.replace(",", "")))
    assert result.data["unit_original"] == unit


@pytest.mark.parametrize(
    "raw, low, high",
    [("13.0 - 17.0", 13.0, 17.0), ("13.0-17.0 g/dL", 13.0, 17.0), ("< 200", None, 200.0), (">= 40", 40.0, None),
     ("Up to 40", None, 40.0), ("0.6 to 1.2", 0.6, 1.2), ("4000 - 11,000", 4000.0, 11000.0), ("", None, None),
     ("see note", None, None)],
)
def test_reference_range_parsing(raw, low, high):
    assert parse_reference_range(raw) == (low, high)


def test_reference_range_is_converted_with_the_value():
    result = normalize_lab("HGB", "120", "g/L", "130 - 170")
    assert (result.data["reference_low"], result.data["reference_high"]) == (13.0, 17.0)
    assert result.data["flag"] == "low"


@pytest.mark.parametrize("value, low, high, flag", [(5, 4, 6, "normal"), (3, 4, 6, "low"), (7, 4, 6, "high"),
                                                     (250, None, 200, "high"), (35, 40, None, "low"), (5, None, None, None)])
def test_compute_flag(value, low, high, flag):
    assert compute_flag(value, low, high) == flag


def test_unrecognized_test_is_kept_but_flagged():
    result = normalize_lab("Anti-Xyz Antibody", "12", "U/mL", "0 - 10")
    assert result.data["canonical_code"] is None
    assert result.data["value"] == 12
    assert any("unrecognized" in issue for issue in result.issues)
    assert result.ceiling < 0.85


def test_implausible_value_is_flagged():
    # OCR dropped the decimal point: albumin 4.5 read as 45
    result = normalize_lab("Albumin", "45", "g/dL", "3.5 - 5.2")
    assert any("plausible" in issue for issue in result.issues)
    assert result.ceiling < 0.85


def test_non_convertible_unit_is_flagged():
    result = normalize_lab("Serum Creatinine", "89.3", "pmol/L")
    assert any("not convertible" in issue for issue in result.issues)


def test_qualitative_result():
    result = normalize_lab("CRP", "Negative", None)
    assert result.data["value"] is None
    assert result.data["value_text"] == "Negative"
    assert result.issues == []


def test_missing_unit_assumes_canonical_with_issue():
    result = normalize_lab("Hemoglobin", "13.5", None)
    assert result.data["value"] == 13.5
    assert any("unit missing" in issue for issue in result.issues)


def test_missing_reference_range_falls_back_to_typical_range():
    from app.normalize.labs import normalize_lab

    result = normalize_lab("Potassium", "3.2", "mmol/L", range_raw=None)
    assert result.data["reference_low"] is not None
    assert result.data["flag"] == "low"


def test_qualitative_result_keeps_value_original_numeric_or_null():
    from app.normalize.labs import normalize_lab

    result = normalize_lab("HBsAg", "Non reactive", None)
    assert result.data["value_text"] == "Non reactive"
    assert result.data["value_original"] is None
