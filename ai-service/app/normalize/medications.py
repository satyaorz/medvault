"""Medication normalization: brand → generic, strength, form and dosing.

"TAB. Pan 40  1-0-0 BF x 7 days" →
    generic Pantoprazole (brand Pan), tablet, 40 mg, OD, schedule 1-0-0, before food, 7 days
"""

from __future__ import annotations

import difflib
import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.normalize.frequency import parse_dosing
from app.normalize.text import clean, norm_key, ocr_shape, title_case

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "medicines.json"

FORM_PREFIXES: dict[str, str] = {
    "tab": "tablet", "tabs": "tablet", "tablet": "tablet", "tablets": "tablet", "t": "tablet",
    "cap": "capsule", "caps": "capsule", "capsule": "capsule", "capsules": "capsule",
    "syp": "syrup", "syr": "syrup", "syrup": "syrup", "susp": "syrup", "suspension": "syrup", "liq": "syrup",
    "inj": "injection", "injection": "injection",
    "drop": "drops", "drops": "drops", "gtt": "drops", "eye drops": "drops", "ear drops": "drops",
    "oint": "ointment", "ointment": "ointment", "cream": "ointment", "gel": "ointment", "lotion": "ointment",
    "inhaler": "inhaler", "rotacap": "inhaler", "rotacaps": "inhaler", "respule": "inhaler", "respules": "inhaler",
    "puff": "inhaler", "mdi": "inhaler",
    "sachet": "other", "powder": "other", "pwd": "other", "patch": "other",
}
_FORM_RE = re.compile(
    r"^\s*(?:\d+[.)]\s*)?(" + "|".join(sorted((re.escape(k) for k in FORM_PREFIXES if k != "t"), key=len, reverse=True)) + r")\b\.?\s*",
    re.I,
)
_STRENGTH = re.compile(
    r"(?<![A-Za-z])(\d+(?:\.\d+)?)\s*(mg|mcg|µg|ug|g|gm|ml|iu|units?|%|k)?\b(?:\s*/\s*(\d+(?:\.\d+)?)\s*(mg|ml|mcg))?",
    re.I,
)
# Trailing descriptors that don't change the molecule.
_SUFFIXES = {"sr", "xr", "er", "cr", "mr", "od", "xl", "la", "forte", "plus", "ds", "dt", "md", "tab", "tablet", "cap"}


@dataclass(frozen=True)
class Medicine:
    generics: tuple[str, ...]
    brand: str | None

    @property
    def generic_name(self) -> str:
        return " + ".join(self.generics)

    @property
    def canonical_key(self) -> str:
        return "+".join(sorted(g.lower() for g in self.generics))


@lru_cache(maxsize=1)
def _index() -> dict[str, Medicine]:
    raw = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    index: dict[str, Medicine] = {}
    for generic in raw["generics_only"]:
        index.setdefault(norm_key(generic), Medicine(generics=(generic,), brand=None))
    for entry in raw["brands"]:
        generics = tuple(entry["generics"])
        for name in entry["names"]:
            key = norm_key(name)
            if key in index and index[key].brand is None and generics == index[key].generics:
                continue  # a generic listed as "brand" of itself
            index.setdefault(key, Medicine(generics=generics, brand=name))
    return index


def lookup_medicine(name: str) -> tuple[Medicine | None, str, str]:
    """Find a medicine by brand or generic name.

    Returns (medicine, how, matched_text) with how ∈ {"exact", "fuzzy", "none"}.
    Longest token prefix wins, so "Pan D" is not mistaken for "Pan".
    """
    index = _index()
    tokens = norm_key(name).split()
    # drop trailing numbers and descriptors for matching
    while tokens and (tokens[-1].replace(".", "").isdigit() or tokens[-1] in _SUFFIXES):
        tokens.pop()
    for end in range(len(tokens), 0, -1):
        candidate = " ".join(tokens[:end])
        if candidate in index:
            return index[candidate], "exact", candidate
        # tolerate glued brand + strength like "pan40"
        stripped = re.sub(r"\d+$", "", candidate).strip()
        if stripped and stripped != candidate and stripped in index:
            return index[stripped], "exact", stripped
    full = " ".join(tokens)
    for end in range(len(tokens), 0, -1):
        shape = ocr_shape(" ".join(tokens[:end]))
        if len(shape) >= 4:
            for key, medicine in index.items():
                if ocr_shape(key) == shape:
                    return medicine, "fuzzy", key
    if len(full) >= 5:
        best = difflib.get_close_matches(full, [k for k in index if len(k) >= 4], n=1, cutoff=0.85)
        if best:
            return index[best[0]], "fuzzy", best[0]
    return None, "none", full


def split_form(text: str) -> tuple[str | None, str]:
    """'TAB. Augmentin 625' → ('tablet', 'Augmentin 625')."""
    match = _FORM_RE.match(text)
    if not match:
        return None, text.strip()
    return FORM_PREFIXES[match.group(1).lower()], text[match.end():].strip()


def parse_strength(text: str | None, form: str | None) -> tuple[float | None, str | None]:
    """'625', '40 mg', '5ml', '500mg/5ml', '60K' → (value, unit)."""
    if not text:
        return None, None
    match = _STRENGTH.search(text)
    if not match:
        return None, None
    value = float(match.group(1))
    unit = (match.group(2) or "").lower()
    if unit == "k":  # "60K" vitamin D3 = 60,000 IU
        return value * 1000, "IU"
    unit = {"gm": "g", "µg": "mcg", "ug": "mcg", "iu": "IU", "unit": "units"}.get(unit, unit)
    if not unit:
        unit = "ml" if form == "syrup" else "mg"
    return value, unit


@dataclass
class MedicationNormalization:
    data: dict
    issues: list[str]
    ceiling: float


def normalize_medication(
    name_raw: str | None,
    strength_raw: str | None = None,
    form_raw: str | None = None,
    schedule_raw: str | None = None,
    duration_raw: str | None = None,
    instructions: str | None = None,
) -> MedicationNormalization | None:
    name_original = clean(name_raw)
    if not name_original:
        return None
    issues: list[str] = []
    ceiling = 1.0

    form, name_rest = split_form(name_original)
    if form_raw:
        form_from_field, _ = split_form(form_raw + " x")
        form = form_from_field or FORM_PREFIXES.get(norm_key(form_raw)) or form

    medicine, how, _matched = lookup_medicine(name_rest)

    # Strength: explicit field first, otherwise digits left in the name ("Pan 40").
    dose_value, dose_unit = parse_strength(strength_raw, form)
    if dose_value is None:
        dose_value, dose_unit = parse_strength(_strength_part(name_rest), form)

    if medicine is None:
        generic_name = title_case(_strip_strength(name_rest) or name_rest)
        canonical_key = norm_key(generic_name)
        brand = None
        issues.append(f"unrecognized medicine name '{_strip_strength(name_rest) or name_rest}'")
        ceiling = min(ceiling, 0.6)
    else:
        generic_name = medicine.generic_name
        canonical_key = medicine.canonical_key
        brand = medicine.brand
        if how == "fuzzy":
            issues.append(f"medicine name '{name_rest}' matched approximately to {medicine.brand or medicine.generic_name}")
            ceiling = min(ceiling, 0.8)

    dosing = parse_dosing(schedule_raw, duration_raw, instructions)
    issues.extend(dosing.issues)
    if dosing.issues:
        ceiling = min(ceiling, 0.6)
    if dosing.frequency_code is None:
        issues.append("dosing frequency not found")
        ceiling = min(ceiling, 0.75)

    data = {
        "name_original": name_original,
        "generic_name": generic_name,
        "brand_name": brand,
        "canonical_key": canonical_key,
        "form": form,
        "dose_value": dose_value,
        "dose_unit": dose_unit,
        "frequency_code": dosing.frequency_code,
        "times_per_day": dosing.times_per_day,
        "schedule": dosing.schedule,
        "timing": dosing.timing,
        "duration_days": dosing.duration_days,
        "instructions": clean(instructions),
    }
    return MedicationNormalization(data=data, issues=issues, ceiling=ceiling)


def _strength_part(name: str) -> str | None:
    # Only numbers that appear after the brand words count as strength ("Telma 40", not "Uprise-D3").
    match = re.search(r"(?:^|\s)(\d+(?:\.\d+)?\s*(?:mg|mcg|g|gm|ml|iu|k|units?)?(?:\s*/\s*\d+(?:\.\d+)?\s*(?:mg|ml)?)?)\s*$", name, re.I)
    return match.group(1) if match else None


def _strip_strength(name: str) -> str:
    return re.sub(r"\s+\d+(?:\.\d+)?\s*(?:mg|mcg|g|gm|ml|iu|k|units?)?\s*$", "", name, flags=re.I).strip()
