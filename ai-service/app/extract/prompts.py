"""Prompts, the compact LLM output schema, and its conversion to `RawExtraction`.

Token budget matters: a local 8B model on a laptop GPU generates ~6 tokens/s. Instead of
copying each source line verbatim, the model cites the **line number** (`ln`) of the
numbered OCR text, and keys are short. That roughly halves the output.

The schema asks only for transcription ("as written") — never for interpretation.
Normalization (brand → generic, units, 1-0-1 → BD) happens in tested Python code.
"""

from __future__ import annotations

import re

from app.normalize.text import norm_key
from app.schemas import (
    RawAllergy,
    RawDiagnosis,
    RawDocument,
    RawEncounter,
    RawExtraction,
    RawLab,
    RawMedication,
)

_S = {"type": "string"}
_NS = {"type": ["string", "null"]}
_LN = {"type": "integer"}


def _obj(properties: dict) -> dict:
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


_ROWS = {"type": "array", "items": _S}

# Facts are pipe-delimited rows inside a JSON-schema-constrained object. Compared with one
# JSON object per fact (keys + indentation) this cuts generated tokens by ~3x.
ROW_FIELDS = {
    "labs": ("ln", "name", "value", "unit", "range", "flag"),
    "meds": ("ln", "name", "dosing", "duration", "note"),
    "diagnoses": ("ln", "name", "status"),
    "allergies": ("ln", "substance", "reaction"),
    "encounters": ("ln", "type", "date", "relative"),
}

EXTRACTION_SCHEMA = _obj({
    "doc": _obj({"date": _NS, "facility": _NS, "doctor": _NS, "patient": _NS}),
    "labs": _ROWS,
    "meds": _ROWS,
    "diagnoses": _ROWS,
    "allergies": _ROWS,
    "encounters": _ROWS,
})

CLASSIFY_SCHEMA = _obj({
    "doc_type": {"type": "string", "enum": ["prescription", "lab_report", "discharge_summary", "other"]},
})

SYSTEM_PROMPT = """You transcribe facts from the numbered OCR text of a patient's medical document.

Output minified JSON. Each fact is ONE string with fields separated by "|"; leave a field empty when it is not written:
- labs:       "ln|test name|value|unit|reference range|H or L flag"
- meds:       "ln|medicine name with Tab./Cap. and strength|dosing (e.g. 1-0-1 AF, OD, SOS)|duration (e.g. x 5 days)|other instructions"
- diagnoses:  "ln|diagnosis|status (provisional, known case, history) "
- allergies:  "ln|substance|reaction"
- encounters: "ln|visit or admission or discharge or follow_up|date as written|relative phrase such as after 2 weeks"
ln is the line number where the fact appears.

Rules:
- Copy text exactly as written. Do not convert units, expand abbreviations, interpret dosing codes or translate brand names.
- Only include facts explicitly present. Never guess.
- Items on a pharmacy bill or invoice are not prescriptions.

Example for a prescription:
{"doc":{"date":"12/01/2026","facility":"Shanti Clinic","doctor":"Dr. M. Kapoor","patient":"Rohan K"},"labs":[],"meds":["9|TAB. Pan 40|1-0-0 BF|x 7 days|","10|Syp. Crocin 5ml|SOS||"],"diagnoses":["6|Acid Peptic Disease|"],"allergies":[],"encounters":["3|visit|12/01/2026|","12|follow_up||after 2 weeks"]}
Example for a lab report (section headings like "LIPID PROFILE" are not tests):
{"doc":{"date":"21/05/2026","facility":"Sunrise Pathology Lab","doctor":null,"patient":"Mr. A. Mehta"},"labs":["8|HGB|136|g/L|130 - 170|","9|Glucose (Fasting)|6.30|mmol/L|3.89 - 5.55|H","12|Total Cholesterol|182|mg/dL|< 200|"],"meds":[],"diagnoses":[],"allergies":[],"encounters":[]}"""

_FOCUS = {
    "lab_report": "Document type: laboratory report. Fill labs; meds is usually empty.",
    "prescription": "Document type: prescription. Fill meds, diagnoses, allergies and encounters.",
    "discharge_summary": "Document type: discharge summary. Fill encounters (admission, discharge, follow_up), diagnoses, allergies, discharge meds and any labs listed.",
    "other": "Document type: other (bill, certificate, receipt...). Fill doc; add diagnoses/allergies/labs only if clearly stated; meds must stay empty.",
}


def number_lines(text: str) -> tuple[str, list[str]]:
    lines = [line for line in text.splitlines() if line.strip()]
    return "\n".join(f"{i}| {line.strip()}" for i, line in enumerate(lines, start=1)), lines


def user_prompt(numbered_text: str, doc_type: str) -> str:
    focus = _FOCUS.get(doc_type, _FOCUS["other"])
    return f"{focus}\n\n{numbered_text}"


CLASSIFY_PROMPT = (
    "Classify this medical document as one of: prescription, lab_report, discharge_summary, other.\n\n"
    "Document text:\n<<<\n{text}\n>>>"
)


def trim_for_llm(text: str, max_chars: int) -> str:
    """Keep the head and tail of very long documents (tables are usually up front)."""
    if len(text) <= max_chars:
        return text
    head = int(max_chars * 0.75)
    tail = max_chars - head
    return text[:head] + "\n...[truncated]...\n" + text[-tail:]


# ------------------------------------------------------------------ conversion


def _cited_line(lines: list[str], ln, *needles: str | None) -> str | None:
    """The cited OCR line (or a neighbour) that really contains the extracted value.

    Returns None if the citation doesn't check out; the pipeline then grounds the item by
    searching for a synthesized snippet in the whole text, and caps confidence if absent.
    """
    if not isinstance(ln, int):
        return None
    keys = [norm_key(n) for n in needles if n and norm_key(n)]
    if not keys:
        return None
    for index in (ln - 1, ln - 2, ln):  # the cited line, then the line above/below
        if 0 <= index < len(lines):
            haystack = norm_key(lines[index])
            if all(key in haystack for key in keys):
                if index != ln - 1 and 0 <= ln - 1 < len(lines):
                    return f"{lines[min(index, ln - 1)].strip()} {lines[max(index, ln - 1)].strip()}"
                return lines[index].strip()
    return None


def _snippet(*parts: str | None) -> str | None:
    text = " ".join(p for p in parts if p)
    return text or None


def compact_to_raw(data: dict, lines: list[str]) -> RawExtraction:
    """Map the compact LLM JSON onto RawExtraction, resolving line citations to source text."""
    keys = ("doc", "labs", "meds", "diagnoses", "allergies", "encounters")
    if not isinstance(data, dict) or not any(key in data for key in keys):
        raise TypeError("LLM output is not an extraction object")
    for key in keys[1:]:
        if key in data and data[key] is not None and not isinstance(data[key], list):
            raise TypeError(f"'{key}' must be a list")
        data[key] = [parse_row(row, ROW_FIELDS[key]) for row in data.get(key) or []]
        data[key] = [row for row in data[key] if row is not None]
    doc = data.get("doc") or {}
    raw = RawExtraction(document=RawDocument(
        date_as_written=doc.get("date"), facility=doc.get("facility"), doctor=doc.get("doctor"),
        patient_name=doc.get("patient"),
    ))
    for lab in data.get("labs") or []:
        lab = _repair_lab_row(lab, lines)
        if lab is None:
            continue
        value = lab.get("value")
        source = _cited_line(lines, lab.get("ln"), lab.get("name"), _numeric_core(value)) or \
            _snippet(lab.get("name"), value, lab.get("unit"))
        raw.lab_results.append(RawLab(
            test_name_as_written=lab.get("name"), value_as_written=value, unit_as_written=lab.get("unit"),
            reference_range_as_written=lab.get("range"), flag_as_written=lab.get("flag"), source_text=source,
        ))
    for med in data.get("meds") or []:
        name = med.get("name")
        source = _cited_line(lines, med.get("ln"), _first_word(name)) or _snippet(name, med.get("dosing"))
        raw.medications.append(RawMedication(
            name_as_written=name, schedule_as_written=med.get("dosing"),
            duration_as_written=med.get("duration"), instructions=med.get("note"), source_text=source,
        ))
    for dx in data.get("diagnoses") or []:
        source = _cited_line(lines, dx.get("ln"), dx.get("name")) or dx.get("name")
        raw.diagnoses.append(RawDiagnosis(name=dx.get("name"), status_as_written=dx.get("status"), source_text=source))
    for allergy in data.get("allergies") or []:
        source = _cited_line(lines, allergy.get("ln"), allergy.get("substance")) or allergy.get("substance")
        raw.allergies.append(RawAllergy(substance=allergy.get("substance"), reaction=allergy.get("reaction"),
                                        source_text=source))
    for enc in data.get("encounters") or []:
        anchor = enc.get("date") or enc.get("relative")
        source = _cited_line(lines, enc.get("ln"), anchor) or anchor
        raw.encounters.append(RawEncounter(
            type=enc.get("type"), date_as_written=enc.get("date"), relative_as_written=enc.get("relative"),
            facility=doc.get("facility"), doctor=doc.get("doctor"),
            notes=_line(lines, enc.get("ln")) if enc.get("type") == "follow_up" else None, source_text=source,
        ))
    return raw


def _repair_lab_row(lab: dict, lines: list[str]) -> dict | None:
    """Small models sometimes shift fields ("CBC | Hemoglobin: 10.7 gm% (13-17)").
    If the value isn't a value, re-read the cited OCR line with the deterministic parser."""
    from app.extract.rules import parse_lab_line  # local import: rules imports this module's siblings
    from app.normalize.text import QUALITATIVE_RESULTS

    value = (lab.get("value") or "").strip()
    looks_ok = bool(re.fullmatch(r"[<>]?=?\s*\d[\d,]*(?:\.\d+)?\s*\*?[HLhl]?", value)) or value.lower() in QUALITATIVE_RESULTS
    if looks_ok:
        return lab
    candidates = []
    if isinstance(lab.get("ln"), int) and 1 <= lab["ln"] <= len(lines):
        candidates.append(lines[lab["ln"] - 1])
    joined = " ".join(str(v) for k, v in lab.items() if k != "ln" and v)
    candidates.append(re.sub(r"\s*[:|]\s*", "  ", joined))
    for text in candidates:
        parsed = parse_lab_line(text)
        if parsed:
            return {"ln": lab.get("ln"), "name": parsed.test_name_as_written, "value": parsed.value_as_written,
                    "unit": parsed.unit_as_written, "range": parsed.reference_range_as_written,
                    "flag": parsed.flag_as_written}
    return None


def parse_row(row, fields: tuple[str, ...]) -> dict | None:
    """'12|HGB|136|g/L|130 - 170|' → {'ln': 12, 'name': 'HGB', ...}; None if unusable."""
    if isinstance(row, dict):  # tolerate a model that emits objects anyway
        return row
    if not isinstance(row, str) or "|" not in row:
        return None
    parts = [p.strip() for p in row.split("|")]
    if len(parts) > len(fields):  # extra pipes belong to the last free-text field
        parts = parts[: len(fields) - 1] + [" ".join(parts[len(fields) - 1:]).strip()]
    parts += [""] * (len(fields) - len(parts))
    out: dict = {}
    for field, value in zip(fields, parts):
        out[field] = value or None
    try:
        out["ln"] = int(str(out["ln"]).strip().rstrip(":")) if out["ln"] else None
    except ValueError:
        out["ln"] = None
    if not out.get(fields[1]):
        return None
    return out


def _numeric_core(value: str | None) -> str | None:
    if not value:
        return None
    match = re.search(r"\d[\d,]*(?:\.\d+)?", value)
    return match.group(0) if match else value


def _first_word(name: str | None) -> str | None:
    if not name:
        return None
    words = [w for w in re.split(r"[\s.]+", name) if w and w.lower() not in {"tab", "cap", "syp", "syrup", "inj", "tablet", "capsule"}]
    return words[0] if words else None


def _line(lines: list[str], ln) -> str | None:
    if isinstance(ln, int) and 1 <= ln <= len(lines):
        return lines[ln - 1].strip()
    return None
