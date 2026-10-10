from app.extract.pipeline import extract
from app.extract.rules import extract_rules, parse_lab_line, parse_med_line
from tests.conftest import DISCHARGE, LAB_REPORT, PRESCRIPTION


def _by_kind(response, kind):
    return [item for item in response.items if item.kind == kind]


def test_parse_lab_line_variants():
    lab = parse_lab_line("HGB : 132 g/L (130-170)")
    assert (lab.test_name_as_written, lab.value_as_written, lab.unit_as_written, lab.reference_range_as_written) == (
        "HGB", "132", "g/L", "130-170")
    lab = parse_lab_line("Hemoglobin  13.5 L  g/dL  13.0 - 17.0")
    assert lab.flag_as_written == "L" and lab.unit_as_written == "g/dL"
    lab = parse_lab_line("25-OH Vitamin D  27  ng/mL  30 - 100")
    assert lab.test_name_as_written == "25-OH Vitamin D" and lab.value_as_written == "27"
    lab = parse_lab_line("Vitamin D (25-OH)  27.7  ng/mL")       # number inside the name is not the value
    assert lab.value_as_written == "27.7"
    lab = parse_lab_line("Investigation  12.0  5 - 10  mg/dL")    # range before unit
    assert lab is not None


def test_parse_lab_line_ignores_non_results():
    for line in ["Age/Sex : 52 Y / M", "Collected On : 20/05/2026", "14, MG Road, Pune - 411001 | Ph: 020-2555 0101",
                 "Lab No : 943992", "BP: 142/90 mmHg", "TAB. Pan 40 1-0-0 x 7 days", "*** End of Report ***"]:
        assert parse_lab_line(line) is None, line


def test_parse_med_line_variants():
    med, consumed = parse_med_line("1. TAB. Augmentin 625   1-0-1  x 5 days  (after food)")
    assert med.name_as_written == "TAB. Augmentin 625" and med.schedule_as_written.startswith("1-0-1")
    assert med.instructions == "after food" and not consumed
    med, _ = parse_med_line("Tab Pan 40 mg - 1-0-0 - BF - 7 days")
    assert med.name_as_written == "Tab Pan 40 mg"
    med, consumed = parse_med_line("5. TAB. Telma 40", "      1-0-0 BF x 30 days")
    assert consumed and med.schedule_as_written == "1-0-0 BF x 30 days"
    # a bill line has no dosing → not a prescription
    assert parse_med_line("Augmentin 625 Tab  B123  10  220.00")[0] is None
    # without a Tab./Cap. prefix the drug must be known
    assert parse_med_line("Walk 30 minutes daily")[0] is None


def test_rules_extract_lab_report():
    raw = extract_rules(LAB_REPORT, "lab_report")
    assert raw.document.date_as_written == "2026-05-21"           # "Reported On" preferred
    assert raw.document.facility == "CITYCARE DIAGNOSTICS"
    assert raw.document.patient_name == "Mr. Arjun Mehta"
    assert len(raw.lab_results) == 6


def test_pipeline_lab_report_contract_shape():
    response = extract(LAB_REPORT, "lab_report")
    assert response.provider == "rules" and response.model is None
    assert response.document.date == "2026-05-21"
    labs = {item.data["canonical_code"]: item for item in _by_kind(response, "lab_result")}
    assert set(labs) == {"hba1c", "glucose_fasting", "hemoglobin", "platelets", "wbc", "vitamin_d"}
    hgb = labs["hemoglobin"]
    assert hgb.data["value"] == 13.6 and hgb.data["unit"] == "g/dL" and hgb.data["unit_original"] == "g/L"
    assert hgb.data["measured_at"] == "2026-05-21"
    assert hgb.grounded and hgb.confidence >= 0.85 and hgb.issues == []
    assert labs["vitamin_d"].data["flag"] == "low"
    assert labs["glucose_fasting"].data["value"] == 113.5
    # contract: no empty strings anywhere
    for item in response.items:
        assert all(value != "" for value in item.data.values())
        assert set(item.model_dump()) == {"kind", "data", "source_text", "confidence", "grounded", "issues"}


def test_pipeline_prescription():
    response = extract(PRESCRIPTION, "prescription")
    meds = {item.data["canonical_key"]: item.data for item in _by_kind(response, "medication")}
    assert set(meds) == {"amlodipine", "rosuvastatin", "metformin", "paracetamol", "telmisartan"}
    assert meds["amlodipine"]["dose_value"] == 10 and meds["amlodipine"]["frequency_code"] == "OD"
    assert meds["metformin"]["frequency_code"] == "BD" and meds["metformin"]["timing"] == "after_food"
    assert meds["paracetamol"]["form"] == "syrup" and meds["paracetamol"]["frequency_code"] == "SOS"
    assert meds["telmisartan"]["duration_days"] == 30
    diagnoses = [item.data["name"] for item in _by_kind(response, "diagnosis")]
    assert diagnoses == ["Essential Hypertension", "Type 2 Diabetes Mellitus"]
    allergies = _by_kind(response, "allergy")
    assert allergies[0].data == {"substance": "Penicillin", "reaction": "rash"}
    encounters = {item.data["type"]: item.data for item in _by_kind(response, "encounter")}
    assert encounters["visit"]["date"] == "2026-08-15"
    assert encounters["visit"]["doctor"] == "Dr. Arjun Sharma"
    assert encounters["follow_up"]["date"] == "2026-11-15"


def test_pipeline_discharge_summary():
    response = extract(DISCHARGE, "discharge_summary")
    assert response.document.date == "2026-03-05"
    encounters = {item.data["type"]: item.data["date"] for item in _by_kind(response, "encounter")}
    assert encounters["admission"] == "2026-03-02"
    assert encounters["discharge"] == "2026-03-05"
    assert encounters["follow_up"] == "2026-03-12"           # computed from "after 1 week"
    follow = next(i for i in _by_kind(response, "encounter") if i.data["type"] == "follow_up")
    assert follow.issues and follow.confidence < 0.85       # computed dates go to review
    assert {i.data["canonical_key"] for i in _by_kind(response, "medication")} == {"pantoprazole", "ondansetron"}
    assert {i.data["canonical_code"] for i in _by_kind(response, "lab_result")} == {"hemoglobin", "creatinine"}
    assert [i.data["name"] for i in _by_kind(response, "diagnosis")] == ["Acute Gastroenteritis", "Essential Hypertension"]


def test_low_ocr_confidence_lowers_confidence_and_adds_issue():
    clean = extract(LAB_REPORT, "lab_report", ocr_confidence=1.0)
    noisy = extract(LAB_REPORT, "lab_report", ocr_confidence=0.6)
    assert all(n.confidence < c.confidence for n, c in zip(noisy.items, clean.items))
    assert all(any("OCR" in issue for issue in item.issues) for item in noisy.items)


def test_no_allergy_statements_produce_no_items():
    text = "Rx\nAllergies: NKDA\n1. TAB. Pan 40  1-0-0 x 7 days"
    response = extract(text, "prescription")
    assert _by_kind(response, "allergy") == []


def test_other_documents_never_yield_prescriptions():
    bill = "MEDICAL STORE\nBill No: 12  Date: 16/08/2026\nTAB. Augmentin 625  1-0-1  x 5 days  Rs 220.00"
    response = extract(bill, "other")
    assert _by_kind(response, "medication") == []
