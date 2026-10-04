import pytest

from app.normalize.frequency import parse_dosing
from app.normalize.medications import lookup_medicine, normalize_medication, parse_strength, split_form


@pytest.mark.parametrize(
    "name, key, brand",
    [
        ("Pan 40", "pantoprazole", "Pan"),
        ("Pantocid", "pantoprazole", "Pantocid"),
        ("Pan-D", "domperidone+pantoprazole", "Pan-D"),       # longest match wins over "Pan"
        ("Augmentin 625", "amoxicillin+clavulanate", "Augmentin"),
        ("Dolo 650", "paracetamol", "Dolo"),
        ("Glycomet GP 1", "glimepiride+metformin", "Glycomet GP"),
        ("Taxim-O 200", "cefixime", "Taxim-O"),
        ("Amlong", "amlodipine", "Amlong"),
        ("Atorvastatin", "atorvastatin", None),                # generic maps to itself
        ("Montair LC", "levocetirizine+montelukast", "Montair LC"),
        ("Thyronorm 50 mcg", "levothyroxine", "Thyronorm"),
    ],
)
def test_brand_to_generic(name, key, brand):
    medicine, how, _ = lookup_medicine(name)
    assert medicine is not None and medicine.canonical_key == key
    assert medicine.brand == brand
    assert how == "exact"


def test_ocr_lookalike_brand_is_fuzzy():
    medicine, how, _ = lookup_medicine("Amiong 5")  # 'l' read as 'i'
    assert medicine.canonical_key == "amlodipine"
    assert how == "fuzzy"


@pytest.mark.parametrize(
    "text, form, rest",
    [("TAB. Augmentin 625", "tablet", "Augmentin 625"), ("Cap Omez 20", "capsule", "Omez 20"),
     ("Syp. Crocin", "syrup", "Crocin"), ("1. Inj. Monocef 1g", "injection", "Monocef 1g"),
     ("Augmentin 625", None, "Augmentin 625")],
)
def test_split_form(text, form, rest):
    assert split_form(text) == (form, rest)


@pytest.mark.parametrize(
    "text, form, value, unit",
    [("625", "tablet", 625, "mg"), ("40 mg", "tablet", 40, "mg"), ("5ml", "syrup", 5, "ml"), ("5", "syrup", 5, "ml"),
     ("60K", None, 60000, "IU"), ("50 mcg", "tablet", 50, "mcg"), ("50/500", "tablet", 50, "mg"), (None, None, None, None)],
)
def test_parse_strength(text, form, value, unit):
    assert parse_strength(text, form) == ((float(value) if value is not None else None), unit)


@pytest.mark.parametrize(
    "text, code, per_day, schedule, timing, days",
    [
        ("1-0-1 x 5 days", "BD", 2, "1-0-1", None, 5),
        ("1-0-0 BF x 7 days", "OD", 1, "1-0-0", "before_food", 7),
        ("0-0-1", "OD", 1, "0-0-1", None, None),
        ("1-1-1 AF for 1 week", "TDS", 3, "1-1-1", "after_food", 7),
        ("½-0-½ after food x 2 wks", "BD", 2, "½-0-½", "after_food", 14),
        ("1/2-0-1/2", "BD", 2, "½-0-½", None, None),
        ("1-0-1 - 3 days", "BD", 2, "1-0-1", None, 3),           # "- 3" is a duration, not a 4th slot
        ("OD", "OD", 1, None, None, None),
        ("BD x 1 month", "BD", 2, None, None, 30),
        ("TDS", "TDS", 3, None, None, None),
        ("QID", "QID", 4, None, None, None),
        ("HS", "HS", 1, None, "bedtime", None),
        ("SOS", "SOS", None, None, None, None),
        ("once daily before breakfast", "OD", 1, None, "before_food", None),
        ("twice a day", "BD", 2, None, None, None),
        ("weekly x 8 weeks", "WEEKLY", None, None, None, 56),
        ("STAT", "STAT", None, None, None, None),
    ],
)
def test_parse_dosing(text, code, per_day, schedule, timing, days):
    dosing = parse_dosing(text)
    assert (dosing.frequency_code, dosing.times_per_day, dosing.schedule, dosing.timing, dosing.duration_days) == (
        code, per_day, schedule, timing, days)


def test_schedule_conflict_is_reported():
    dosing = parse_dosing("1-0-1 TDS")
    assert dosing.frequency_code == "BD"
    assert dosing.issues and "conflicts" in dosing.issues[0]


def test_normalize_medication_full_payload():
    result = normalize_medication("TAB. Pan 40", schedule_raw="1-0-0 BF x 7 days", instructions="Before breakfast")
    assert result.data == {
        "name_original": "TAB. Pan 40",
        "generic_name": "Pantoprazole",
        "brand_name": "Pan",
        "canonical_key": "pantoprazole",
        "form": "tablet",
        "dose_value": 40.0,
        "dose_unit": "mg",
        "frequency_code": "OD",
        "times_per_day": 1,
        "schedule": "1-0-0",
        "timing": "before_food",
        "duration_days": 7,
        "instructions": "Before breakfast",
    }
    assert result.issues == []


def test_combination_generic_name():
    result = normalize_medication("TAB. Augmentin 625", schedule_raw="1-0-1 x 5 days")
    assert result.data["generic_name"] == "Amoxicillin + Clavulanate"
    assert result.data["canonical_key"] == "amoxicillin+clavulanate"


def test_unknown_medicine_flagged():
    result = normalize_medication("Tab Xyzolol 5", schedule_raw="OD")
    assert result.data["canonical_key"] == "xyzolol"
    assert result.data["brand_name"] is None
    assert any("unrecognized medicine name 'Xyzolol'" in issue for issue in result.issues)
    assert result.ceiling < 0.85


def test_missing_frequency_flagged():
    result = normalize_medication("Tab Pan 40")
    assert result.data["frequency_code"] is None
    assert any("frequency" in issue for issue in result.issues)
