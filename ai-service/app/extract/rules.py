"""Deterministic regex extractor.

Roles: (1) offline fallback when no LLM is reachable, (2) the evaluation baseline,
(3) a cross-check — items found by both the LLM and the rules get a confidence boost.

It relies on OCR having kept table rows on one line (see app/ocr.py).
"""

from __future__ import annotations

import re

from app.normalize.dates import find_dates
from app.normalize.frequency import _CODES, _DURATION, _SCHEDULE
from app.normalize.labs import catalog
from app.normalize.medications import lookup_medicine, split_form
from app.normalize.text import QUALITATIVE_RESULTS, clean
from app.schemas import (
    RawAllergy,
    RawDiagnosis,
    RawDocument,
    RawEncounter,
    RawExtraction,
    RawLab,
    RawMedication,
)

# ----------------------------------------------------------------- document meta

_DATE_LABELS = {
    "discharge_summary": [r"date of discharge", r"discharged? on", r"discharge date", r"\bdod\b"],
    "lab_report": [r"report(?:ed)? (?:date|on)", r"date of report", r"collected (?:on|date)", r"collection date",
                   r"sample (?:date|collected(?: on)?)", r"registered on", r"\bdate\b"],
    "prescription": [r"\bdate\b", r"\bdated\b"],
    "other": [r"\bdate\b", r"\bdated\b", r"bill date", r"invoice date"],
}
_FACILITY_WORDS = re.compile(
    r"\b(hospital|clinic|diagnostics?|laborator(?:y|ies)|labs?|pathology|medical (?:cent(?:re|er)|college)|"
    r"nursing home|health ?care|polyclinic|imaging|scan cent(?:re|er)|pharmacy|chemists?|medicals|institute|centre|center)\b",
    re.I,
)
_DOCTOR = re.compile(r"\bDr\.?\s+([A-Z][A-Za-z.'-]*(?: [A-Z][A-Za-z.'-]*){0,3})")
_QUALIFICATION = re.compile(r"\s+\b(MBBS|MD|MS|DM|DNB|FRCS|MRCP|BAMS|BHMS|BDS|DCH|DGO|PhD|M\.?D\.?|M\.?B\.?B\.?S\.?)\b.*$")
_PATIENT = re.compile(
    r"(?:patient(?:'s)?\s+name|name\s+of\s+(?:the\s+)?patient|patient|\bname)\s*[:\-]\s*"
    r"((?:(?:mr|mrs|ms|miss|master|baby|smt|shri)\.?\s+)?[A-Z][A-Za-z.'-]*(?:\s[A-Z][A-Za-z.'-]*){0,3})",
    re.I,
)
_NON_DOC_DATE_CONTEXT = re.compile(r"(dob|d\.o\.b|birth|age|valid|expiry|exp\.?|mfg)\W*$", re.I)


def _labelled_date(text: str, doc_type: str) -> tuple[str | None, str | None]:
    labels = _DATE_LABELS.get(doc_type, []) + _DATE_LABELS["other"]
    for label in labels:
        for match in re.finditer(label + r"\s*[:\-]?\s*", text, re.I):
            window = text[match.end(): match.end() + 40]
            dates = find_dates(window)
            if dates and dates[0][0] <= 3:
                line = _line_at(text, match.start())
                return dates[0][2].isoformat(), line
    return None, None


def _first_plain_date(text: str) -> str | None:
    for start, _end, value in find_dates(text):
        context = text[max(0, start - 25): start]
        if not _NON_DOC_DATE_CONTEXT.search(context):
            return value.isoformat()
    return None


def _line_at(text: str, index: int) -> str:
    start = text.rfind("\n", 0, index) + 1
    end = text.find("\n", index)
    return text[start: end if end != -1 else len(text)].strip()


def _facility(lines: list[str]) -> str | None:
    for line in lines[:8]:
        for segment in re.split(r"\s{2,}|\|", line):
            if _FACILITY_WORDS.search(segment) and not re.search(r"\b(dr\.|ref|patient|name)\b", segment, re.I):
                value = clean(re.split(r",|\bph(?:one)?\b|\btel\b", segment, flags=re.I)[0])
                if value and 3 <= len(value) <= 80:
                    return value
    return None


def extract_document_meta(text: str, doc_type: str) -> RawDocument:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    date, _ = _labelled_date(text, doc_type)
    doctor = _DOCTOR.search(text)
    patient = _PATIENT.search(text)
    patient_name = None
    if patient:
        patient_name = clean(re.split(r"\s{2,}|\b(?:age|sex|gender|uhid|id)\b", patient.group(1), flags=re.I)[0])
    return RawDocument(
        date_as_written=date or _first_plain_date(text),
        facility=_facility(lines),
        doctor=clean("Dr. " + _QUALIFICATION.sub("", doctor.group(1))) if doctor else None,
        patient_name=patient_name,
    )


# --------------------------------------------------------------------------- labs

_VALUE_TOKEN = re.compile(r"(?<![A-Za-z0-9.^/])([<>]=?\s*)?(\d[\d,]*(?:\.\d+)?)(?![\d.]*[A-Za-z]*\^)")
_FLAG_TOKEN = re.compile(r"^\s*(\*?[HL]\b|high\b|low\b|↑|↓|\*)", re.I)
_RANGE_IN_REST = re.compile(
    r"\(?\s*(?:\d[\d,]*(?:\.\d+)?\s*(?:-|–|to)\s*\d[\d,]*(?:\.\d+)?|(?:<=?|>=?|≤|≥|up\s*to|upto)\s*\d[\d,]*(?:\.\d+)?)\s*\)?",
    re.I,
)
_SKIP_LAB_LINE = re.compile(
    r"^\s*(age|sex|gender|date|dob|name|patient|ref|referred|sample|specimen|collected|received|reported|"
    r"registered|uhid|id|ip|op|mobile|phone|tel|page|bill|invoice|amount|total amount|bp|blood pressure|pulse|"
    r"weight|height|temp|temperature|spo2|bmi|rr|follow|review|tab|cap|syp|inj|reg|lab no|barcode)\b",
    re.I,
)
_TEST_NAME_SHAPE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .,()\-/%+'&]*$")
_UNKNOWN_NAME_SHAPE = re.compile(r"^[A-Za-z][A-Za-z0-9 .()\-/%+']{2,40}$")
_NOT_A_RESULT = re.compile(
    r"\b(ph|phone|tel|mobile|email|e-mail|www|gstin|helpline|road|street|floor|plot|sector|nagar|pin|"
    r"bill|invoice|receipt|rs|inr|amount|qty|batch|mrp)\b|@",
    re.I,
)


def parse_lab_line(line: str) -> RawLab | None:
    raw_line = line.strip()
    if len(raw_line) < 4 or _SKIP_LAB_LINE.match(raw_line) or _NOT_A_RESULT.search(raw_line):
        return None
    if split_form(raw_line)[0] is not None:  # "Tab. ..." lines are medications
        return None
    cat = catalog()
    for match in _VALUE_TOKEN.finditer(raw_line):
        name = raw_line[: match.start()].strip(" :-=\t|")
        name = re.sub(r"\s{2,}", " ", name)
        if not name or not re.search(r"[A-Za-z]", name) or len(name) > 60:
            continue
        if not _TEST_NAME_SHAPE.match(name) or len(name.split()) > 7:
            continue
        if name.count("(") > name.count(")"):  # number inside "(25-OH)" is part of the name
            continue
        test, how = cat.lookup(name)
        if test is None and not re.search(r"[A-Za-z]{2,}", name):
            continue
        rest = raw_line[match.end():]
        range_match = _RANGE_IN_REST.search(rest)
        if test is None and (range_match is None or not _UNKNOWN_NAME_SHAPE.match(name)):
            continue
        value = (match.group(1) or "").replace(" ", "") + match.group(2)
        flag = None
        flag_match = _FLAG_TOKEN.match(rest)
        if flag_match:
            flag = flag_match.group(1).strip("*") or "*"
            rest = rest[flag_match.end():]
            range_match = _RANGE_IN_REST.search(rest)
        range_text = None
        if range_match:
            range_text = range_match.group(0).strip(" ()")
            rest = rest[: range_match.start()] + " " + rest[range_match.end():]
        unit = None
        for chunk in rest.split():
            chunk = chunk.strip("()[],;")
            if chunk and (re.search(r"[A-Za-zµμ%/^³]", chunk)) and not re.fullmatch(r"[HL]", chunk):
                unit = chunk
                break
        confidence = 0.9
        if test is None:
            confidence = 0.75
        elif how == "fuzzy":
            confidence = 0.8
        if unit is None:
            confidence -= 0.05
        return RawLab(
            test_name_as_written=name,
            value_as_written=value,
            unit_as_written=unit,
            reference_range_as_written=range_text,
            flag_as_written=flag,
            source_text=raw_line,
            extractor_confidence=confidence,
        )
    # Qualitative results: "HIV I & II   Non Reactive"
    for word in sorted(QUALITATIVE_RESULTS, key=len, reverse=True):
        idx = raw_line.lower().find(" " + word)
        if idx > 0:
            name = raw_line[:idx].strip(" :-")
            test, _ = cat.lookup(name)
            if test is not None:
                return RawLab(test_name_as_written=name, value_as_written=word, source_text=raw_line,
                              extractor_confidence=0.85)
    return None


def extract_labs(text: str) -> list[RawLab]:
    labs = []
    for line in text.splitlines():
        lab = parse_lab_line(line)
        if lab:
            labs.append(lab)
    return labs


# -------------------------------------------------------------------- medications

_BULLET = re.compile(r"^\s*(?:\d{1,2}\s*[.)]|[-•*●▪]|\(\w\))\s*")


def _dosing_start(text: str) -> int | None:
    positions = []
    for pattern in [_SCHEDULE, _DURATION] + [p for p, _c, _n in _CODES]:
        match = pattern.search(text)
        if match:
            positions.append(match.start())
    return min(positions) if positions else None


def parse_med_line(line: str, next_line: str | None = None) -> tuple[RawMedication | None, bool]:
    """Parse one prescription line. Returns (medication, consumed_next_line)."""
    body = _BULLET.sub("", line.strip())
    form, rest = split_form(body)
    if not rest:
        return None, False
    # The name must come first, so find where the dosing instructions begin *after* it.
    first_word = re.match(r"\S+", rest)
    search_from = first_word.end() if first_word else 0
    offset = _dosing_start(rest[search_from:])
    consumed = False
    if offset is None and next_line is not None and split_form(next_line.strip())[0] is None:
        # dosing on a continuation line: "Tab Telma 40\n   1-0-0 x 30 days"
        if _dosing_start(next_line) is not None and not _BULLET.match(next_line):
            name_part, dosing_part, consumed = rest, next_line.strip(), True
        else:
            return None, False
    elif offset is None:
        return None, False
    else:
        name_part = rest[: search_from + offset]
        dosing_part = rest[search_from + offset:]
    name_part = name_part.strip(" -–:,|")
    if not name_part or not re.search(r"[A-Za-z]{2,}", name_part):
        return None, False

    medicine, how, _ = lookup_medicine(name_part)
    if form is None and (medicine is None or how != "exact"):
        return None, False  # without "Tab./Cap." we need a known drug name

    instructions = None
    paren = re.search(r"\(([^)]*)\)", dosing_part)
    if paren and not re.search(r"\d\s*-\s*\d", paren.group(1)):
        instructions = paren.group(1)
    trailing = re.search(r"(?:--|—|;)\s*(.+)$", dosing_part)
    if trailing and not instructions:
        instructions = trailing.group(1)

    confidence = 0.92 if medicine is not None and how == "exact" else 0.8
    source = line.strip() if not consumed else f"{line.strip()} {next_line.strip()}"
    return (
        RawMedication(
            name_as_written=(f"{body[: len(body) - len(rest)].strip()} {name_part}").strip(),
            strength_as_written=None,
            form_as_written=None,
            schedule_as_written=dosing_part.strip(" -–:,|"),
            duration_as_written=None,
            instructions=clean(instructions),
            source_text=source,
            extractor_confidence=confidence,
        ),
        consumed,
    )


def extract_medications(text: str) -> list[RawMedication]:
    lines = text.splitlines()
    meds: list[RawMedication] = []
    skip_next = False
    for i, line in enumerate(lines):
        if skip_next:
            skip_next = False
            continue
        if not line.strip():
            continue
        nxt = lines[i + 1] if i + 1 < len(lines) else None
        med, consumed = parse_med_line(line, nxt)
        if med:
            meds.append(med)
            skip_next = consumed
    return meds


# ------------------------------------------------------- diagnoses / allergies

_DX_HEADER = re.compile(
    r"^\s*(?:(final|provisional|working|primary|secondary)\s+)?(diagnosis|diagnoses|dx|impression|assessment)\s*[:\-]\s*(.*)$",
    re.I,
)
_KCO = re.compile(r"\b(?:k/c/o|kco|known case of)\s*[:\-]?\s*(.+)$", re.I)
_SECTION_HEADER = re.compile(r"^\s*[A-Za-z][A-Za-z /&()]{2,40}\s*:\s*", re.I)
_NO_ALLERGY = re.compile(r"\b(nkda|nkfa|no known (?:drug )?allerg|nil|none|no allerg|not known)\b", re.I)
_ALLERGY_HEADER = re.compile(r"^\s*(?:known\s+)?(?:drug\s+)?allerg(?:y|ies)(?:\s+to)?\s*[:\-]\s*(.*)$", re.I)
_ALLERGIC_TO = re.compile(r"\ballergic to\s+(.+?)(?:\.|$)", re.I)


def _dx_status(prefix: str | None, item: str) -> str:
    text = f"{prefix or ''} {item}".lower()
    if re.search(r"\b(provisional|suspected|probable|query|r/o|rule out)\b|\?", text):
        return "suspected"
    if re.search(r"\b(h/o|history of|resolved|old|post)\b", text):
        return "resolved"
    return "active"


def _split_items(value: str) -> list[str]:
    parts = re.split(r"[;,]|\s+\band\b\s+|\s+&\s+|\s{2,}", value)
    out = []
    for part in parts:
        part = _BULLET.sub("", part).strip(" .-:")
        if part and re.search(r"[A-Za-z]{3,}", part) and len(part) <= 80:
            out.append(part)
    return out


def _section_values(lines: list[str], index: int, first: str) -> tuple[list[tuple[str, str]], int]:
    """Values of a 'Header: value' section, plus bullet lines that follow it."""
    values: list[tuple[str, str]] = []
    if first.strip():
        values.extend((item, lines[index].strip()) for item in _split_items(first))
    j = index + 1
    while j < len(lines):
        nxt = lines[j]
        if not nxt.strip() or _SECTION_HEADER.match(nxt) or split_form(_BULLET.sub("", nxt.strip()))[0]:
            break
        if not first.strip() or _BULLET.match(nxt):
            values.extend((item, nxt.strip()) for item in _split_items(nxt))
            j += 1
            continue
        break
    return values, j


def extract_diagnoses(text: str) -> list[RawDiagnosis]:
    lines = text.splitlines()
    found: list[RawDiagnosis] = []
    seen: set[str] = set()
    for i, line in enumerate(lines):
        match = _DX_HEADER.match(line)
        items: list[tuple[str, str]] = []
        prefix = None
        if match:
            prefix = match.group(1)
            items, _ = _section_values(lines, i, match.group(3))
        else:
            kco = _KCO.search(line)
            if kco:
                items = [(item, line.strip()) for item in _split_items(kco.group(1))]
        for item, source in items:
            key = item.lower()
            if key in seen:
                continue
            seen.add(key)
            found.append(RawDiagnosis(name=item, status_as_written=_dx_status(prefix, item),
                                      source_text=source, extractor_confidence=0.88))
    return found


def extract_allergies(text: str) -> list[RawAllergy]:
    lines = text.splitlines()
    found: list[RawAllergy] = []
    for i, line in enumerate(lines):
        match = _ALLERGY_HEADER.match(line)
        values: list[tuple[str, str]] = []
        if match:
            if _NO_ALLERGY.search(match.group(1) or ""):
                continue
            values, _ = _section_values(lines, i, match.group(1))
        else:
            allergic = _ALLERGIC_TO.search(line)
            if allergic:
                values = [(item, line.strip()) for item in _split_items(allergic.group(1))]
        for value, source in values:
            if _NO_ALLERGY.search(value):
                continue
            reaction = None
            paren = re.search(r"\(([^)]*)\)", value)
            if paren:
                reaction = paren.group(1)
                value = value[: paren.start()].strip()
            else:
                dash = re.split(r"\s+[-–]\s+|\s+causes\s+", value, maxsplit=1)
                if len(dash) == 2:
                    value, reaction = dash
            found.append(RawAllergy(substance=clean(value), reaction=clean(reaction), source_text=source,
                                    extractor_confidence=0.9))
    return found


# -------------------------------------------------------------------- encounters

_FOLLOW_UP = re.compile(r"\b(follow[- ]?up|review|next visit|revisit|come back|report back|f/u)\b", re.I)


def extract_encounters(text: str, doc_type: str, meta: RawDocument) -> list[RawEncounter]:
    encounters: list[RawEncounter] = []
    if doc_type == "discharge_summary":
        for kind, labels in (
            ("admission", [r"date of admission", r"admitted on", r"admission date", r"\bdoa\b"]),
            ("discharge", [r"date of discharge", r"discharged on", r"discharge date", r"\bdod\b"]),
        ):
            for label in labels:
                match = re.search(label + r"\s*[:\-]?\s*", text, re.I)
                if not match:
                    continue
                dates = find_dates(text[match.end(): match.end() + 40])
                if dates and dates[0][0] <= 3:
                    encounters.append(RawEncounter(
                        type=kind, date_as_written=dates[0][2].isoformat(), facility=meta.facility,
                        doctor=meta.doctor, source_text=_line_at(text, match.start()), extractor_confidence=0.92,
                    ))
                    break
    elif doc_type == "prescription" and meta.date_as_written:
        _, source = _labelled_date(text, "prescription")
        encounters.append(RawEncounter(
            type="visit", date_as_written=meta.date_as_written, facility=meta.facility, doctor=meta.doctor,
            source_text=source or meta.doctor or meta.date_as_written, extractor_confidence=0.9,
        ))

    if doc_type in ("prescription", "discharge_summary"):
        for line in text.splitlines():
            if not _FOLLOW_UP.search(line):
                continue
            dates = find_dates(line)
            relative = re.search(r"(?:after|in|within|next)\s+(?:\d+|one|two|three|four|six|a)\s*(?:days?|weeks?|wks?|months?|years?)", line, re.I)
            if not dates and not relative:
                continue
            encounters.append(RawEncounter(
                type="follow_up",
                date_as_written=dates[0][2].isoformat() if dates else None,
                relative_as_written=relative.group(0) if relative and not dates else None,
                facility=meta.facility,
                doctor=meta.doctor,
                notes=clean(line),
                source_text=line.strip(),
                extractor_confidence=0.88,
            ))
            break
    return encounters


# ------------------------------------------------------------------------- entry


def extract_rules(text: str, doc_type: str) -> RawExtraction:
    meta = extract_document_meta(text, doc_type)
    result = RawExtraction(document=meta)
    if doc_type in ("lab_report", "discharge_summary", "other", "unknown"):
        result.lab_results = extract_labs(text)
    if doc_type in ("prescription", "discharge_summary", "unknown"):
        result.medications = extract_medications(text)
    if doc_type != "lab_report":
        result.diagnoses = extract_diagnoses(text)
        result.allergies = extract_allergies(text)
    result.encounters = extract_encounters(text, doc_type, meta)
    return result
