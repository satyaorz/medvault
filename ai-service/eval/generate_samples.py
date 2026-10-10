"""Generate the synthetic evaluation dataset (and the demo patient set).

    python -m eval.generate_samples            # writes eval/dataset/ and eval/demo/

Everything is seeded and deterministic. Each dataset document gets a ground-truth file
`<id>.truth.json`; values are recorded in *canonical* units exactly as the system should
compute them from the printed (possibly converted and rounded) values.

All people, clinics and labs are fictional.
"""

from __future__ import annotations

import json
import random
import shutil
from datetime import date, timedelta
from pathlib import Path

from app.normalize.labs import catalog, convert
from eval.render import Document, to_pdf, to_photo_jpeg, to_scanned_pdf, to_screenshot_png

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "dataset"
DEMO = ROOT / "demo"

PATIENTS = [
    ("Rohan Kulkarni", 46, "M"), ("Priya Iyer", 34, "F"), ("Amit Verma", 58, "M"), ("Sneha Reddy", 29, "F"),
    ("Kavita Joshi", 63, "F"), ("Imran Shaikh", 41, "M"), ("Deepa Menon", 52, "F"), ("Arvind Rao", 67, "M"),
    ("Neha Bansal", 38, "F"), ("Suresh Pillai", 55, "M"), ("Ananya Das", 24, "F"), ("Vikram Sethi", 49, "M"),
]
LABS = [
    ("CityCare Diagnostics", "14, MG Road, Pune - 411001"),
    ("Sunrise Pathology Lab", "Plot 7, Sector 21, Navi Mumbai"),
    ("Lotus Clinical Laboratory", "2nd Floor, Lake View Complex, Bengaluru"),
    ("Green Valley Diagnostics", "Near Bus Stand, Nashik"),
    ("Prime Health Labs", "88 Park Street, Kolkata"),
]
CLINICS = [
    ("Shanti Family Clinic", "Dr. Meera Kapoor", "MBBS, MD (General Medicine)"),
    ("Heart & Diabetes Care Centre", "Dr. Arjun Sharma", "MBBS, DM (Cardiology)"),
    ("Wellness Polyclinic", "Dr. Farhan Qureshi", "MBBS, DNB (Family Medicine)"),
    ("Sai Children & Family Clinic", "Dr. Lata Deshmukh", "MBBS, MD (Medicine)"),
    ("Riverside Medical Centre", "Dr. Karthik Subramanian", "MBBS, MD"),
]
HOSPITALS = [
    ("City General Hospital", "Dr. Rajesh Khanna", "Department of Internal Medicine"),
    ("Sanjeevani Multispeciality Hospital", "Dr. Nandini Rao", "Department of Medicine"),
    ("Lifeline Hospital & Research Centre", "Dr. Sameer Gupta", "Department of General Surgery"),
]
REFERRERS = ["Dr. Meera Kapoor", "Dr. Arjun Sharma", "Self", "Dr. Farhan Qureshi", "Dr. K. Subramanian"]

# name variants a lab might print for each test (subset of the catalog aliases)
LAB_NAMES = {
    "hemoglobin": ["Hemoglobin", "Haemoglobin", "Hb", "HGB"],
    "wbc": ["Total WBC Count", "Total Leucocyte Count", "WBC", "TLC"],
    "rbc": ["RBC Count", "Total RBC Count", "RBC"],
    "platelets": ["Platelet Count", "Platelets", "PLT"],
    "hematocrit": ["Hematocrit", "PCV", "HCT"],
    "mcv": ["MCV"], "mch": ["MCH"], "mchc": ["MCHC"],
    "neutrophils": ["Neutrophils"], "lymphocytes": ["Lymphocytes"],
    "esr": ["ESR"],
    "hba1c": ["HbA1c", "Glycated Haemoglobin (HbA1c)", "Glycosylated Hemoglobin"],
    "glucose_fasting": ["Fasting Blood Sugar", "Glucose (Fasting)", "FBS", "Plasma Glucose Fasting"],
    "glucose_pp": ["Post Prandial Blood Sugar", "Glucose (PP)", "PPBS"],
    "cholesterol_total": ["Total Cholesterol", "Cholesterol, Total", "Serum Cholesterol"],
    "ldl": ["LDL Cholesterol", "LDL-C", "LDL Cholesterol (Direct)"],
    "hdl": ["HDL Cholesterol", "HDL-C", "HDL"],
    "triglycerides": ["Triglycerides", "Serum Triglycerides", "TG"],
    "vldl": ["VLDL Cholesterol", "VLDL"],
    "creatinine": ["Serum Creatinine", "Creatinine", "S. Creatinine"],
    "urea": ["Blood Urea", "Urea", "Serum Urea"],
    "uric_acid": ["Uric Acid", "Serum Uric Acid"],
    "alt": ["SGPT (ALT)", "ALT", "SGPT"],
    "ast": ["SGOT (AST)", "AST", "SGOT"],
    "alp": ["Alkaline Phosphatase", "ALP"],
    "bilirubin_total": ["Total Bilirubin", "Bilirubin, Total"],
    "albumin": ["Albumin", "Serum Albumin"],
    "tsh": ["TSH", "TSH (Ultrasensitive)", "Thyroid Stimulating Hormone"],
    "t3": ["Total T3", "T3"], "t4": ["Total T4", "T4"],
    "vitamin_d": ["25-OH Vitamin D", "Vitamin D (25-OH)", "Vitamin D Total", "25 Hydroxy Vitamin D"],
    "vitamin_b12": ["Vitamin B12", "Vit B12"],
    "sodium": ["Sodium", "Serum Sodium", "Sodium (Na+)"],
    "potassium": ["Potassium", "Serum Potassium", "Potassium (K+)"],
    "chloride": ["Chloride", "Serum Chloride"],
    "calcium": ["Calcium", "Serum Calcium"],
}
PANELS = {
    "COMPLETE BLOOD COUNT (CBC)": ["hemoglobin", "wbc", "rbc", "platelets", "hematocrit", "mcv", "mch", "mchc", "neutrophils", "lymphocytes"],
    "DIABETES PROFILE": ["hba1c", "glucose_fasting", "glucose_pp"],
    "LIPID PROFILE": ["cholesterol_total", "triglycerides", "hdl", "ldl", "vldl"],
    "KIDNEY FUNCTION TEST": ["urea", "creatinine", "uric_acid"],
    "LIVER FUNCTION TEST": ["bilirubin_total", "alt", "ast", "alp", "albumin"],
    "THYROID PROFILE": ["t3", "t4", "tsh"],
    "VITAMINS": ["vitamin_d", "vitamin_b12"],
    "ELECTROLYTES": ["sodium", "potassium", "chloride", "calcium"],
}
# canonical value generators (mostly normal, sometimes abnormal)
VALUE_RANGES = {
    "hemoglobin": (10.5, 16.5, 1), "wbc": (4.2, 12.5, 1), "rbc": (3.9, 5.8, 2), "platelets": (140, 420, 0),
    "hematocrit": (34, 50, 1), "mcv": (76, 98, 1), "mch": (25, 32, 1), "mchc": (31, 35, 1),
    "neutrophils": (45, 75, 0), "lymphocytes": (18, 42, 0), "esr": (4, 35, 0),
    "hba1c": (5.0, 8.4, 1), "glucose_fasting": (82, 160, 0), "glucose_pp": (100, 240, 0),
    "cholesterol_total": (150, 260, 0), "ldl": (70, 175, 0), "hdl": (32, 62, 0), "triglycerides": (80, 260, 0),
    "vldl": (14, 45, 0), "creatinine": (0.6, 1.6, 2), "urea": (15, 48, 0), "uric_acid": (3.2, 8.4, 1),
    "alt": (12, 85, 0), "ast": (14, 70, 0), "alp": (50, 160, 0), "bilirubin_total": (0.3, 1.6, 2),
    "albumin": (3.4, 4.9, 1), "tsh": (0.6, 7.8, 2), "t3": (85, 180, 0), "t4": (5.5, 12.5, 1),
    "vitamin_d": (9, 48, 1), "vitamin_b12": (150, 780, 0), "sodium": (133, 146, 0), "potassium": (3.4, 5.3, 1),
    "chloride": (96, 108, 0), "calcium": (8.4, 10.4, 1),
}
# alternate units a lab may print: (unit text, probability)
ALT_UNITS = {
    "hemoglobin": [("g/L", 0.2), ("gm%", 0.15)],
    "wbc": [("/cumm", 0.4), ("cells/cu.mm", 0.15)],
    "platelets": [("lakhs/cumm", 0.3), ("/cumm", 0.25)],
    "glucose_fasting": [("mmol/L", 0.2)], "glucose_pp": [("mmol/L", 0.2)],
    "creatinine": [("µmol/L", 0.2)],
    "hba1c": [("mmol/mol", 0.12)],
    "vitamin_d": [("nmol/L", 0.2)],
    "cholesterol_total": [("mmol/L", 0.1)],
    "tsh": [("mIU/L", 0.3)],
}

# brand, form prefix, strength text, dose value, dose unit, canonical key
MEDS = [
    ("Augmentin", "TAB.", "625", 625, "mg", "amoxicillin+clavulanate"),
    ("Pan", "TAB.", "40", 40, "mg", "pantoprazole"),
    ("Omez", "CAP.", "20mg", 20, "mg", "omeprazole"),
    ("Azithral", "TAB.", "500", 500, "mg", "azithromycin"),
    ("Dolo", "TAB.", "650", 650, "mg", "paracetamol"),
    ("Glycomet", "TAB.", "500", 500, "mg", "metformin"),
    ("Amlong", "TAB.", "5", 5, "mg", "amlodipine"),
    ("Telma", "TAB.", "40", 40, "mg", "telmisartan"),
    ("Atorva", "TAB.", "10", 10, "mg", "atorvastatin"),
    ("Rosuvas", "TAB.", "10", 10, "mg", "rosuvastatin"),
    ("Ecosprin", "TAB.", "75", 75, "mg", "aspirin"),
    ("Thyronorm", "TAB.", "50 mcg", 50, "mcg", "levothyroxine"),
    ("Montair LC", "TAB.", "", None, None, "levocetirizine+montelukast"),
    ("Taxim-O", "TAB.", "200", 200, "mg", "cefixime"),
    ("Zerodol-P", "TAB.", "", None, None, "aceclofenac+paracetamol"),
    ("Shelcal", "TAB.", "500", 500, "mg", "calcium carbonate+vitamin d3"),
    ("Pan-D", "CAP.", "", None, None, "domperidone+pantoprazole"),
    ("Ondem", "TAB.", "4", 4, "mg", "ondansetron"),
    ("Cetzine", "TAB.", "10", 10, "mg", "cetirizine"),
    ("Losar", "TAB.", "50", 50, "mg", "losartan"),
    ("Janumet", "TAB.", "50/500", 50, "mg", "metformin+sitagliptin"),
    ("Clopilet", "TAB.", "75", 75, "mg", "clopidogrel"),
    ("Metformin", "TAB.", "500 mg", 500, "mg", "metformin"),
    ("Paracetamol", "TAB.", "500 mg", 500, "mg", "paracetamol"),
]
SYRUPS = [("Crocin", "5ml", 5, "ml", "paracetamol"), ("Ascoril LS", "10ml", 10, "ml", "ambroxol+guaifenesin+levosalbutamol")]
SCHEDULES = [  # text, frequency code
    ("1-0-1", "BD"), ("1-0-0", "OD"), ("0-0-1", "OD"), ("1-1-1", "TDS"), ("OD", "OD"), ("BD", "BD"),
    ("TDS", "TDS"), ("HS", "HS"), ("SOS", "SOS"), ("1-0-1", "BD"), ("1-0-0", "OD"),
]
DIAGNOSES = ["Type 2 Diabetes Mellitus", "Essential Hypertension", "Acute Pharyngitis", "Dyslipidemia",
             "Hypothyroidism", "Upper Respiratory Tract Infection", "Acid Peptic Disease", "Viral Fever",
             "Allergic Rhinitis", "Urinary Tract Infection", "Vitamin D Deficiency", "Osteoarthritis Knee"]
ALLERGENS = [("Penicillin", "rash"), ("Sulfa drugs", None), ("NSAIDs", "swelling"), ("Peanuts", None)]


def fmt_date(d: date, style: int) -> str:
    return [d.strftime("%d/%m/%Y"), d.strftime("%d-%b-%Y"), d.strftime("%d %B %Y"), d.strftime("%d.%m.%Y"),
            d.strftime("%Y-%m-%d")][style % 5]


def _round(value: float, digits: int) -> float:
    return round(value, digits) if digits else float(round(value))


def _num(value: float, digits: int) -> str:
    return f"{value:.{digits}f}" if digits else str(int(round(value)))


# ----------------------------------------------------------------------------- lab


def lab_value(code: str, rng: random.Random, value: float | None = None):
    """Pick a printed name/value/unit/range for a test → (row strings, truth)."""
    cat = catalog()
    test = cat.tests[code]
    lo, hi, digits = VALUE_RANGES[code]
    canonical = value if value is not None else _round(rng.uniform(lo, hi), digits)
    unit_text, factor_digits = test.unit, digits
    for alt, prob in ALT_UNITS.get(code, []):
        if rng.random() < prob:
            unit_text = alt
            break
    if unit_text == test.unit:
        printed = canonical
    else:
        # invert the conversion numerically
        one, _ = convert(test, 1.0, unit_text)
        zero, _ = convert(test, 0.0, unit_text)
        printed = (canonical - zero) / (one - zero)
        factor_digits = 2 if abs(printed) < 10 else (1 if abs(printed) < 1000 else 0)
        if unit_text in ("/cumm", "cells/cu.mm"):
            factor_digits = 0
            printed = round(printed / 100) * 100
    printed = _round(printed, factor_digits)
    truth_value, _ = convert(test, printed, unit_text)

    def to_printed(x):
        if x is None:
            return None
        if unit_text == test.unit:
            return x
        one, _ = convert(test, 1.0, unit_text)
        zero, _ = convert(test, 0.0, unit_text)
        return (x - zero) / (one - zero)

    low, high = to_printed(test.ref_low), to_printed(test.ref_high)
    rd = factor_digits if unit_text != test.unit else (1 if digits == 0 and (high or 0) < 20 else digits)
    if low is not None and high is not None:
        ref = f"{_num(low, rd)} - {_num(high, rd)}"
    elif high is not None:
        ref = f"< {_num(high, rd)}"
    elif low is not None:
        ref = f"> {_num(low, rd)}"
    else:
        ref = ""
    flag = ""
    if test.ref_low is not None and truth_value < test.ref_low:
        flag = "L"
    elif test.ref_high is not None and truth_value > test.ref_high:
        flag = "H"
    name = rng.choice(LAB_NAMES[code])
    truth = {"canonical_code": code, "value": round(truth_value, 4), "unit": test.unit}
    return name, _num(printed, factor_digits), unit_text, ref, flag, truth


def lab_report(rng: random.Random, patient, report_day: date, panels: list[str], lab=None, layout=None,
               fixed: dict[str, float] | None = None):
    lab_name, address = lab or rng.choice(LABS)
    layout = layout if layout is not None else rng.choice(["table", "table", "inline", "range_first"])
    name, age, sex = patient
    collected = report_day - timedelta(days=rng.choice([0, 0, 1]))
    style = rng.randrange(5)
    doc = Document()
    doc.text(lab_name.upper(), x=50, size=16, bold=True, gap=2)
    doc.text(address + "  |  Ph: 020-2555 0101", size=8)
    doc.rule()
    doc.cols([(50, f"Patient Name : {'Mr.' if sex == 'M' else 'Ms.'} {name}"), (330, f"Age/Sex : {age} Y / {sex}")])
    doc.cols([(50, f"Ref. By : {rng.choice(REFERRERS)}"), (330, f"Lab No : {rng.randint(100000, 999999)}")])
    doc.cols([(50, f"Collected On : {fmt_date(collected, style)}"), (330, f"Reported On : {fmt_date(report_day, style)}")])
    doc.rule()
    truths = []
    for panel in panels:
        doc.text(panel, size=11, bold=True, gap=4)
        if layout in ("table", "range_first"):
            header = [(50, "Test Name"), (240, "Result"), (320, "Unit"), (420, "Biological Ref. Range")]
            if layout == "range_first":
                header = [(50, "Investigation"), (240, "Observed Value"), (340, "Reference Interval"), (470, "Units")]
            doc.cols(header, size=9, bold=True)
        for code in PANELS[panel]:
            label, value, unit, ref, flag, truth = lab_value(code, rng, (fixed or {}).get(code))
            truths.append(truth)
            shown = f"{value} {flag}".strip() if rng.random() < 0.7 else value
            if layout == "table":
                doc.cols([(50, label), (240, shown), (320, unit), (420, ref)], size=9.5)
            elif layout == "range_first":
                doc.cols([(50, label), (240, shown), (340, ref), (470, unit)], size=9.5)
            else:
                doc.text(f"{label} : {value} {unit}" + (f"  ({ref})" if ref else ""), size=9.5, gap=3)
        doc.space(6)
    doc.space(10)
    doc.text("*** End of Report ***", x=230, size=9)
    doc.text(f"Dr. {rng.choice(['Priya Nair', 'S. Banerjee', 'Rahul Mehta'])}, MD (Pathology)", x=360, size=9)
    truth = {"doc_type": "lab_report", "date": report_day.isoformat(), "labs": truths, "medications": [],
             "diagnoses": [], "allergies": []}
    return doc, truth


# --------------------------------------------------------------------- prescription


def _distinct_meds(rng: random.Random, count: int) -> list[tuple]:
    """Sample medicines with different active ingredients (no Glycomet + Metformin twice)."""
    chosen, keys = [], set()
    for med in rng.sample(MEDS, len(MEDS)):
        if med[5] not in keys:
            chosen.append(med)
            keys.add(med[5])
        if len(chosen) == count:
            break
    return chosen


def med_line(rng: random.Random, index: int, med=None, schedule=None, days=None, style=None):
    if med is None:
        if rng.random() < 0.12:
            brand, strength, dose, unit, key = rng.choice(SYRUPS)
            sched_text, code = rng.choice([("SOS", "SOS"), ("TDS", "TDS"), ("1-1-1", "TDS")])
            line = f"{index}. Syp. {brand} {strength}  {sched_text}" + (f" x {rng.choice([3, 5])} days" if code != "SOS" else "")
            return [line], {"canonical_key": key, "dose_value": dose, "dose_unit": unit, "frequency_code": code}
        med = rng.choice(MEDS)
    brand, prefix, strength, dose, unit, key = med
    sched_text, code = schedule or rng.choice(SCHEDULES)
    days = days if days is not None else rng.choice([3, 5, 7, 10, 14, 30])
    style = style if style is not None else rng.randrange(5)
    timing = rng.choice(["after food", "before food", "", ""])
    tcode = {"after food": "AF", "before food": "BF", "": ""}[timing]
    name = f"{brand} {strength}".strip()
    if style == 0:
        lines = [f"{index}. {prefix} {name}   {sched_text}  x {days} days" + (f"  ({timing})" if timing else "")]
    elif style == 1:
        prefix2 = prefix.title().rstrip(".")
        lines = [f"{prefix2} {name} - {sched_text}" + (f" - {tcode}" if tcode else "") + f" - {days} days"]
    elif style == 2:
        lines = [f"{index}) {prefix.title()} {name}  {sched_text} for {max(1, days // 7)} week{'s' if days >= 14 else ''}"]
    elif style == 3:
        lines = [f"{index}. {prefix} {name}", f"      {sched_text} {tcode} x {days} days".rstrip()]
    else:
        lines = [f"- {prefix} {name}  --  {sched_text}  x {days} days"]
    return lines, {"canonical_key": key, "dose_value": dose, "dose_unit": unit, "frequency_code": code}


def prescription(rng: random.Random, patient, day: date, clinic=None, meds=None, diagnoses=None,
                 allergy=None, follow_up=None):
    clinic_name, doctor, quals = clinic or rng.choice(CLINICS)
    name, age, sex = patient
    style = rng.randrange(5)
    doc = Document()
    doc.text(clinic_name, size=15, bold=True, gap=2)
    doc.text(f"{doctor}  {quals}  |  Reg. No. MMC/{rng.randint(10000, 99999)}", size=8.5)
    doc.text("Timings: 10 am - 1 pm, 6 pm - 9 pm  |  Ph: 98200 12345", size=8)
    doc.rule()
    doc.cols([(50, f"Name: {name}"), (300, f"Age/Sex: {age}/{sex}"), (430, f"Date: {fmt_date(day, style)}")])
    doc.text(f"BP: {rng.randint(112, 150)}/{rng.randint(70, 96)} mmHg   Pulse: {rng.randint(66, 98)}/min   Wt: {rng.randint(48, 92)} kg", size=9)
    doc.space(4)
    doc.text("C/O: " + rng.choice(["fever and body ache x 3 days", "cough and cold", "routine follow up",
                                   "acidity, bloating", "joint pain", "fatigue"]), size=10)
    dx = diagnoses if diagnoses is not None else rng.sample(DIAGNOSES, rng.choice([1, 1, 2]))
    if dx:
        doc.text("Diagnosis: " + ", ".join(dx), size=10)
    al = allergy if allergy is not None else (rng.choice(ALLERGENS) if rng.random() < 0.25 else ())
    if al:
        doc.text(f"Allergies: {al[0]}" + (f" ({al[1]})" if al[1] else ""), size=10)
    else:
        doc.text("Allergies: NKDA", size=10)
    doc.space(6)
    doc.text("Rx", size=16, bold=True, gap=6)
    truths = []
    if meds is None:
        meds = [(m, None, None) for m in _distinct_meds(rng, rng.randint(2, 5))]
    for i, (med, sched, days) in enumerate(meds, start=1):
        lines, truth = med_line(rng, i, med, sched, days)
        for line in lines:
            doc.text(line, size=10.5, gap=3)
        truths.append(truth)
    doc.space(10)
    if follow_up is None:
        follow_up = rng.choice([f"Follow up after {rng.choice([1, 2])} weeks", "Review after 1 month",
                                f"Review on {fmt_date(day + timedelta(days=rng.choice([10, 14, 30])), 0)}", ""])
    if follow_up:
        doc.text(follow_up, size=10)
    doc.space(18)
    doc.text(doctor, x=400, size=10, bold=True)
    truth = {"doc_type": "prescription", "date": day.isoformat(), "labs": [], "medications": truths,
             "diagnoses": dx, "allergies": [al[0]] if al else []}
    return doc, truth


# ---------------------------------------------------------------- discharge summary


def discharge_summary(rng: random.Random, patient, admit: date, discharge: date, hospital=None, diagnoses=None,
                      allergy=None, meds=None, labs: dict[str, float] | None = None, course: str | None = None,
                      follow_up: str | None = None):
    hosp, doctor, dept = hospital or rng.choice(HOSPITALS)
    name, age, sex = patient
    style = rng.randrange(5)
    doc = Document()
    doc.text(hosp.upper(), size=15, bold=True, gap=2)
    doc.text(f"{dept}  |  24x7 Helpline: 1800 200 300", size=8.5)
    doc.rule()
    doc.text("DISCHARGE SUMMARY", x=220, size=13, bold=True, gap=6)
    doc.cols([(50, f"Patient Name: {name}"), (320, f"Age/Sex: {age} Yrs / {sex}")])
    doc.cols([(50, f"UHID: {rng.randint(1000000, 9999999)}"), (320, f"IP No: IP/{rng.randint(10000, 99999)}")])
    doc.cols([(50, f"Date of Admission: {fmt_date(admit, style)}"), (320, f"Date of Discharge: {fmt_date(discharge, style)}")])
    doc.text(f"Consultant: {doctor}", size=10)
    doc.space(6)
    dx = diagnoses if diagnoses is not None else rng.sample(
        ["Acute Gastroenteritis", "Community Acquired Pneumonia", "Dengue Fever", "Acute Appendicitis",
         "Urinary Tract Infection", "Diabetic Ketoacidosis"], 1) + rng.sample(DIAGNOSES[:5], rng.choice([0, 1]))
    doc.text("Final Diagnosis: " + ", ".join(dx), size=10.5, bold=True)
    al = allergy if allergy is not None else (rng.choice(ALLERGENS) if rng.random() < 0.4 else ())
    doc.text("Allergies: " + ((al[0] + (f" ({al[1]})" if al[1] else "")) if al else "No known drug allergies"), size=10)
    doc.space(6)
    doc.text("Course in Hospital:", size=10.5, bold=True, gap=2)
    course = course or ("Patient was admitted with complaints as above. Managed with IV fluids, antibiotics "
                        "and supportive care. Improved symptomatically and is being discharged in stable condition.")
    words, line = course.split(), ""
    for word in words:
        if len(line) + len(word) > 95:
            doc.text(line, size=9.5, gap=1)
            line = ""
        line += word + " "
    doc.text(line, size=9.5)
    doc.space(4)
    doc.text("Investigations:", size=10.5, bold=True, gap=2)
    lab_truths = []
    codes = labs or {c: None for c in rng.sample(["hemoglobin", "wbc", "platelets", "creatinine", "sodium", "potassium"], 3)}
    for code, value in codes.items():
        label, printed, unit, _ref, _flag, truth = lab_value(code, rng, value)
        doc.text(f"{label}: {printed} {unit}", size=9.5, gap=2)
        lab_truths.append(truth)
    doc.space(6)
    doc.text("Discharge Medications:", size=10.5, bold=True, gap=3)
    med_truths = []
    if meds is None:
        meds = [(m, None, None) for m in _distinct_meds(rng, rng.randint(2, 4))]
    for i, (med, sched, days) in enumerate(meds, start=1):
        lines, truth = med_line(rng, i, med, sched, days, style=rng.choice([0, 0, 1]))
        for line_text in lines:
            doc.text(line_text, size=10, gap=3)
        med_truths.append(truth)
    doc.space(6)
    doc.text(follow_up or f"Follow up: OPD after {rng.choice([1, 2])} week(s) or earlier if symptoms recur.", size=10)
    doc.text("Condition at discharge: Stable", size=10)
    doc.space(16)
    doc.text(doctor, x=400, size=10, bold=True)
    truth = {"doc_type": "discharge_summary", "date": discharge.isoformat(), "labs": lab_truths,
             "medications": med_truths, "diagnoses": dx, "allergies": [al[0]] if al else []}
    return doc, truth


# ---------------------------------------------------------------------------- other


def other_document(rng: random.Random, patient, day: date, kind: str):
    name, age, sex = patient
    style = rng.randrange(5)
    doc = Document()
    if kind == "bill":
        doc.text("SHREE GANESH MEDICAL & GENERAL STORES", size=13, bold=True, gap=2)
        doc.text("Shop 4, Station Road, Thane  |  GSTIN: 27ABCDE1234F1Z5  |  DL No: 20B/1234", size=8)
        doc.rule()
        doc.cols([(50, f"Bill No: SG/{rng.randint(1000, 9999)}"), (330, f"Date: {fmt_date(day, style)}")])
        doc.text(f"Customer: {name}", size=10)
        doc.cols([(50, "Item"), (260, "Batch"), (330, "Qty"), (380, "MRP"), (460, "Amount")], size=9, bold=True)
        total = 0.0
        for brand, prefix, strength, *_ in rng.sample(MEDS, 3):
            qty = rng.choice([10, 15, 30])
            mrp = rng.randint(40, 300)
            amount = mrp * qty / 10
            total += amount
            doc.cols([(50, f"{brand} {strength} {prefix.title().rstrip('.')}".replace("  ", " ")),
                      (260, f"B{rng.randint(100, 999)}"), (330, str(qty)), (380, f"{mrp:.2f}"), (460, f"{amount:.2f}")], size=9.5)
        doc.text(f"Total Amount: Rs. {total:.2f}", x=380, size=10, bold=True)
        doc.text("Goods once sold will not be taken back.", size=8)
    elif kind == "vaccination":
        doc.text("VACCINATION CERTIFICATE", x=180, size=14, bold=True)
        doc.text("Primary Health Centre, Wakad", size=10)
        doc.rule()
        doc.text(f"Beneficiary Name: {name}   Age: {age}   Gender: {sex}", size=10)
        doc.text("Vaccine Name: Hepatitis B (Dose 2)", size=10)
        doc.text(f"Date of Vaccination: {fmt_date(day, style)}", size=10)
        doc.text("Vaccinated by: ANM Sunita Pawar", size=10)
        doc.text("Next dose due as per schedule.", size=10)
    elif kind == "fitness":
        doc.text("MEDICAL FITNESS CERTIFICATE", x=170, size=14, bold=True)
        doc.text("Wellness Polyclinic", size=10)
        doc.rule()
        doc.text(f"Date: {fmt_date(day, style)}", size=10)
        doc.text(f"This is to certify that {name}, aged {age} years, has been examined by me and is", size=10)
        doc.text("found medically fit to resume duties / join the institution.", size=10)
        doc.space(20)
        doc.text("Dr. Farhan Qureshi, MBBS", x=380, size=10)
    else:  # receipt
        doc.text("OPD RECEIPT", x=240, size=14, bold=True)
        doc.text("Riverside Medical Centre", size=10)
        doc.rule()
        doc.cols([(50, f"Receipt No: R-{rng.randint(10000, 99999)}"), (330, f"Date: {fmt_date(day, style)}")])
        doc.text(f"Received with thanks from {name} the sum of Rs. 500/- towards consultation charges.", size=10)
        doc.text("Payment mode: UPI", size=10)
    truth = {"doc_type": "other", "date": day.isoformat(), "labs": [], "medications": [], "diagnoses": [], "allergies": []}
    return doc, truth


# --------------------------------------------------------------------------- writer

FORMATS = ["text_pdf", "text_pdf", "scanned_pdf", "photo_jpg", "text_pdf", "screenshot_png", "scanned_pdf", "photo_jpg", "text_pdf", "text_pdf"]


def write(doc: Document, fmt: str, path_stem: Path, rng: random.Random) -> str:
    pdf = to_pdf(doc)
    if fmt == "text_pdf":
        path, data = path_stem.with_suffix(".pdf"), pdf
    elif fmt == "scanned_pdf":
        path, data = path_stem.with_suffix(".pdf"), to_scanned_pdf(pdf, rng)
    elif fmt == "photo_jpg":
        path, data = path_stem.with_suffix(".jpg"), to_photo_jpeg(pdf, rng)
    else:
        path, data = path_stem.with_suffix(".png"), to_screenshot_png(pdf)
    path.write_bytes(data)
    return path.name


def generate_dataset(seed: int = 7) -> list[dict]:
    rng = random.Random(seed)
    if DATASET.exists():
        shutil.rmtree(DATASET)
    DATASET.mkdir(parents=True)
    plan = ["lab_report"] * 14 + ["prescription"] * 14 + ["discharge_summary"] * 8 + ["other"] * 4
    other_kinds = ["bill", "vaccination", "fitness", "receipt"]
    manifest = []
    for n, kind in enumerate(plan, start=1):
        patient = rng.choice(PATIENTS)
        day = date(2025, 6, 1) + timedelta(days=rng.randint(0, 480))
        if kind == "lab_report":
            panels = rng.sample(list(PANELS), rng.choice([1, 2, 2, 3]))
            doc, truth = lab_report(rng, patient, day, panels)
        elif kind == "prescription":
            doc, truth = prescription(rng, patient, day)
        elif kind == "discharge_summary":
            doc, truth = discharge_summary(rng, patient, day - timedelta(days=rng.randint(2, 6)), day)
        else:
            doc, truth = other_document(rng, patient, day, other_kinds.pop(0))
        fmt = FORMATS[n % len(FORMATS)]
        doc_id = f"{n:02d}_{kind}"
        filename = write(doc, fmt, DATASET / doc_id, rng)
        truth = {"id": doc_id, "file": filename, "format": fmt, **truth}
        (DATASET / f"{doc_id}.truth.json").write_text(json.dumps(truth, indent=2), encoding="utf-8")
        manifest.append({"id": doc_id, "file": filename, "format": fmt, "doc_type": truth["doc_type"]})
    (DATASET / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


# ----------------------------------------------------------------------------- demo


def generate_demo(seed: int = 2026) -> list[dict]:
    """One fictional patient's 2026 story, for the live demo (upload in order)."""
    rng = random.Random(seed)
    if DEMO.exists():
        shutil.rmtree(DEMO)
    DEMO.mkdir(parents=True)
    patient = ("Arjun Mehta", 52, "M")
    lab_a = LABS[0]  # CityCare Diagnostics — prints canonical units
    lab_b = LABS[1]  # Sunrise Pathology Lab — prints g/L, mmol/L, µmol/L
    heart_clinic = CLINICS[1]
    amlong5, amlong10 = ("Amlong", "TAB.", "5", 5, "mg", "amlodipine"), ("Amlong", "TAB.", "10", 10, "mg", "amlodipine")
    atorva = ("Atorva", "TAB.", "10", 10, "mg", "atorvastatin")
    rosuvas = ("Rosuvas", "TAB.", "10", 10, "mg", "rosuvastatin")
    glycomet = ("Glycomet", "TAB.", "500", 500, "mg", "metformin")
    uprise = ("Uprise-D3", "CAP.", "60K", 60000, "IU", "cholecalciferol")
    pan = ("Pan", "TAB.", "40", 40, "mg", "pantoprazole")
    ondem = ("Ondem", "TAB.", "4", 4, "mg", "ondansetron")

    saved_alt = dict(ALT_UNITS)
    items = []

    def save(doc, name, fmt, note):
        filename = write(doc, fmt, DEMO / name, rng)
        items.append({"file": filename, "note": note})

    # 1. Jan blood test (Lab A, canonical units)
    ALT_UNITS.clear()
    doc, _ = lab_report(rng, patient, date(2026, 1, 12), ["DIABETES PROFILE", "COMPLETE BLOOD COUNT (CBC)", "LIPID PROFILE", "VITAMINS"],
                        lab=lab_a, layout="table",
                        fixed={"hba1c": 5.8, "glucose_fasting": 102, "glucose_pp": 138, "hemoglobin": 14.2,
                               "cholesterol_total": 212, "ldl": 136, "hdl": 41, "triglycerides": 168, "vldl": 34,
                               "vitamin_d": 14.0, "vitamin_b12": 310})
    save(doc, "01_2026-01-12_citycare_blood_test", "text_pdf", "Baseline: HbA1c 5.8%, Hb 14.2 g/dL, Vit D 14 (low)")

    # 2. Jan prescription: Amlodipine 5, Atorvastatin 10, Vit D3 weekly; NKDA
    doc, _ = prescription(rng, patient, date(2026, 1, 20), clinic=heart_clinic,
                          meds=[(amlong5, ("1-0-0", "OD"), 30), (atorva, ("0-0-1", "OD"), 30), (uprise, ("weekly", "WEEKLY"), 56)],
                          diagnoses=["Essential Hypertension", "Dyslipidemia", "Vitamin D Deficiency"], allergy=(),
                          follow_up="Review after 3 months with HbA1c, lipid profile")
    save(doc, "02_2026-01-20_prescription", "text_pdf", "Started Amlodipine 5 mg, Atorvastatin 10 mg, Vit D3 60K weekly")

    # 3. March admission: gastroenteritis; penicillin allergy recorded (conflicts with NKDA)
    doc, _ = discharge_summary(rng, patient, date(2026, 3, 2), date(2026, 3, 5), hospital=HOSPITALS[0],
                               diagnoses=["Acute Gastroenteritis", "Essential Hypertension"], allergy=("Penicillin", "rash"),
                               meds=[(pan, ("1-0-0", "OD"), 7), (ondem, ("SOS", "SOS"), 3), (amlong5, ("1-0-0", "OD"), 30), (atorva, ("0-0-1", "OD"), 30)],
                               labs={"hemoglobin": 13.9, "sodium": 133, "potassium": 3.4, "creatinine": 1.1},
                               follow_up="Follow up: OPD after 1 week")
    save(doc, "03_2026-03-05_discharge_summary", "text_pdf", "Admission; Penicillin allergy (rash) documented")

    # 4. May blood test at Lab B with different names/units
    ALT_UNITS.update({"hemoglobin": [("g/L", 1.0)], "glucose_fasting": [("mmol/L", 1.0)], "creatinine": [("µmol/L", 1.0)]})
    doc, _ = lab_report(rng, patient, date(2026, 5, 21), ["DIABETES PROFILE", "COMPLETE BLOOD COUNT (CBC)", "KIDNEY FUNCTION TEST"],
                        lab=lab_b, layout="range_first",
                        fixed={"hba1c": 6.2, "glucose_fasting": 113.5, "glucose_pp": 162, "hemoglobin": 13.6, "creatinine": 0.99})
    save(doc, "04_2026-05-21_sunrise_blood_test", "text_pdf", "Different lab: HGB in g/L, glucose in mmol/L; HbA1c 6.2%")
    ALT_UNITS.clear()

    # 5. May prescription: metformin started
    doc, _ = prescription(rng, patient, date(2026, 5, 28), clinic=heart_clinic,
                          meds=[(amlong5, ("1-0-0", "OD"), 30), (atorva, ("0-0-1", "OD"), 30), (glycomet, ("1-0-1", "BD"), 30)],
                          diagnoses=["Essential Hypertension", "Prediabetes"], allergy=("Penicillin", None),
                          follow_up="Follow up after 2 months")
    save(doc, "05_2026-05-28_prescription", "text_pdf", "Metformin 500 mg BD started")

    # 6. June CBC photographed on a phone (OCR path)
    doc, _ = lab_report(rng, patient, date(2026, 6, 24), ["COMPLETE BLOOD COUNT (CBC)"], lab=lab_a, layout="table",
                        fixed={"hemoglobin": 13.0})
    save(doc, "06_2026-06-24_cbc_phone_photo", "photo_jpg", "Phone photo of a CBC report (Tesseract OCR)")

    # 7. August prescription: Amlodipine 5 → 10, Atorvastatin → Rosuvastatin
    doc, _ = prescription(rng, patient, date(2026, 8, 15), clinic=heart_clinic,
                          meds=[(amlong10, ("1-0-0", "OD"), 30), (rosuvas, ("0-0-1", "OD"), 30), (glycomet, ("1-0-1", "BD"), 30)],
                          diagnoses=["Essential Hypertension", "Type 2 Diabetes Mellitus", "Dyslipidemia"], allergy=("Penicillin", None),
                          follow_up="Review on 15/11/2026 with HbA1c")
    save(doc, "07_2026-08-15_prescription", "text_pdf", "Amlodipine 5→10 mg; Atorvastatin replaced by Rosuvastatin; follow-up 15 Nov 2026")

    # 8. September blood test (Lab A)
    doc, _ = lab_report(rng, patient, date(2026, 9, 2), ["DIABETES PROFILE", "COMPLETE BLOOD COUNT (CBC)", "LIPID PROFILE", "VITAMINS"],
                        lab=lab_a, layout="table",
                        fixed={"hba1c": 6.5, "glucose_fasting": 118, "glucose_pp": 171, "hemoglobin": 12.4,
                               "cholesterol_total": 176, "ldl": 98, "hdl": 44, "triglycerides": 150, "vldl": 30,
                               "vitamin_d": 31.0, "vitamin_b12": 295})
    save(doc, "08_2026-09-02_citycare_blood_test", "text_pdf", "HbA1c 6.5% (rising), Hb 12.4 g/dL (low), LDL improved")

    # 9. A pharmacy bill (should be classified 'other' and produce no prescriptions)
    doc, _ = other_document(rng, patient, date(2026, 8, 16), "bill")
    save(doc, "09_2026-08-16_pharmacy_bill", "screenshot_png", "Pharmacy bill — 'other', no medications extracted")

    ALT_UNITS.clear()
    ALT_UNITS.update(saved_alt)
    (DEMO / "README.md").write_text(
        "# Demo patient: Arjun Mehta (fictional), 52 M\n\nUpload these in order to tell the story:\n\n"
        + "\n".join(f"{i}. `{it['file']}` — {it['note']}" for i, it in enumerate(items, start=1)) + "\n",
        encoding="utf-8",
    )
    return items


if __name__ == "__main__":
    manifest = generate_dataset()
    demo = generate_demo()
    size = sum(p.stat().st_size for p in DATASET.iterdir()) + sum(p.stat().st_size for p in DEMO.iterdir())
    print(f"dataset: {len(manifest)} documents, demo: {len(demo)} documents, total {size / 1e6:.1f} MB")
