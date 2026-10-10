"""Lab result normalization: test-name matching, unit conversion, reference ranges, flags.

This is the "semantic lab normalization engine": three labs that print `Hb 13.2 g/dL`,
`HGB 132 g/L` and `Haemoglobin 13.2 gm%` all end up as
`hemoglobin = 13.2 g/dL`, so values can be trended across reports.
"""

from __future__ import annotations

import difflib
import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from app.normalize.text import QUALITATIVE_RESULTS, clean, fmt_number, norm_key, ocr_shape, parse_number
from app.normalize.units import unit_key

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "lab_tests.json"

# Leading words that don't change which test it is ("Serum Creatinine" == "Creatinine").
_STRIP_PREFIXES = ("serum ", "s ", "plasma ", "blood ", "whole blood ", "estimation of ")
FUZZY_CUTOFF = 0.86


@dataclass(frozen=True)
class LabTest:
    code: str
    name: str
    unit: str
    unit_key: str | None
    conversions: dict[str, float | str]
    ref_low: float | None
    ref_high: float | None
    plausible_low: float | None
    plausible_high: float | None


@dataclass
class LabCatalog:
    tests: dict[str, LabTest]
    alias_index: dict[str, str] = field(default_factory=dict)  # norm alias -> code

    def lookup(self, name: str) -> tuple[LabTest | None, str]:
        """Return (test, how) where how ∈ {"exact", "fuzzy", "none"}."""
        key = _name_key(name)
        if not key:
            return None, "none"
        # "Glucose Fasting (Hexokinase)" / "Glycated Haemoglobin (HbA1c)": try without and
        # with only the parenthetical part as well.
        raw_variants = [name, re.sub(r"\(.*?\)|\[.*?\]", " ", name), *re.findall(r"\((.*?)\)", name)]
        for raw in raw_variants:
            for candidate in _key_variants(_name_key(raw)):
                code = self.alias_index.get(candidate)
                if code:
                    return self.tests[code], "exact"
        key = _name_key(raw_variants[1]) or key
        # OCR look-alikes ("Haemog1obin", "HbAlc") count as approximate matches.
        shape = ocr_shape(key)
        for alias, code in self.alias_index.items():
            if len(alias) >= 4 and ocr_shape(alias) == shape:
                return self.tests[code], "fuzzy"
        # Fuzzy only for reasonably long names: short aliases (K, Na, TG) must match exactly.
        if len(key) >= 5:
            pool = [alias for alias in self.alias_index if len(alias) >= 4]
            best = difflib.get_close_matches(key, pool, n=1, cutoff=FUZZY_CUTOFF)
            if best:
                return self.tests[self.alias_index[best[0]]], "fuzzy"
        return None, "none"


def _name_key(name: str) -> str:
    key = norm_key(name)
    # "Haemoglobin (Hb)" / "Hemoglobin - Hb" style duplicates are handled by alias entries;
    # strip trailing method notes like "by hplc", "(calculated)" when not an alias.
    key = re.sub(r"\b(by|method)\b.*$", "", key).strip()
    return key


def _key_variants(key: str):
    yield key
    for prefix in _STRIP_PREFIXES:
        if key.startswith(prefix):
            yield key[len(prefix):]
    no_paren = re.sub(r"\s+", " ", re.sub(r"\b(calculated|direct|ultrasensitive|quantitative)\b", "", key)).strip()
    if no_paren != key:
        yield no_paren


@lru_cache(maxsize=1)
def catalog() -> LabCatalog:
    raw = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    tests: dict[str, LabTest] = {}
    index: dict[str, str] = {}
    for entry in raw["tests"]:
        conversions = {}
        for unit, factor in entry.get("conversions", {}).items():
            conversions[unit_key(unit)] = factor
        ref = entry.get("ref") or [None, None]
        plausible = entry.get("plausible") or [None, None]
        test = LabTest(
            code=entry["code"],
            name=entry["name"],
            unit=entry["unit"],
            unit_key=unit_key(entry["unit"]),
            conversions=conversions,
            ref_low=ref[0],
            ref_high=ref[1],
            plausible_low=plausible[0],
            plausible_high=plausible[1],
        )
        tests[test.code] = test
        for alias in [entry["name"], *entry["aliases"]]:
            index.setdefault(_name_key(alias), test.code)
    return LabCatalog(tests=tests, alias_index=index)


# ------------------------------------------------------------------ conversions


def convert(test: LabTest, value: float, unit_raw: str | None) -> tuple[float | None, str | None]:
    """Convert `value` printed in `unit_raw` into the test's canonical unit.

    Returns (converted, problem). `problem` is a short reason when conversion isn't possible.
    """
    key = unit_key(unit_raw)
    if key is None or key == test.unit_key:
        return value, None
    factor = test.conversions.get(key)
    if factor is None:
        return None, f"unit '{unit_raw}' is not convertible to {test.unit}"
    if factor == "hba1c_ifcc":  # IFCC mmol/mol → NGSP %
        return value / 10.929 + 2.15, None
    return value * float(factor), None


_RANGE_BETWEEN = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*(?:-|to|–|—)\s*(\d[\d,]*(?:\.\d+)?)", re.I)
_RANGE_UPPER = re.compile(r"(?:<=?|≤|less than|up\s*to|upto|below)\s*(\d[\d,]*(?:\.\d+)?)", re.I)
_RANGE_LOWER = re.compile(r"(?:>=?|≥|more than|greater than|above)\s*(\d[\d,]*(?:\.\d+)?)", re.I)


def parse_reference_range(raw: str | None) -> tuple[float | None, float | None]:
    """'13.0 - 17.0', '< 200', '>= 40', 'Up to 40', '0.6 to 1.2 mg/dL' → (low, high)."""
    if not raw:
        return None, None
    text = str(raw).replace(",", "")
    match = _RANGE_BETWEEN.search(text)
    if match:
        low, high = float(match.group(1)), float(match.group(2))
        if low <= high:
            return low, high
    match = _RANGE_UPPER.search(text)
    if match:
        return None, float(match.group(1))
    match = _RANGE_LOWER.search(text)
    if match:
        return float(match.group(1)), None
    return None, None


def compute_flag(value: float | None, low: float | None, high: float | None) -> str | None:
    if value is None or (low is None and high is None):
        return None
    if low is not None and value < low:
        return "low"
    if high is not None and value > high:
        return "high"
    return "normal"


def printed_flag(raw: str | None) -> str | None:
    if not raw:
        return None
    token = raw.strip().lower()
    if token in {"h", "high", "↑", "hi", "*h"}:
        return "high"
    if token in {"l", "low", "↓", "lo", "*l"}:
        return "low"
    return None


# ------------------------------------------------------------------- normalize


@dataclass
class LabNormalization:
    data: dict
    issues: list[str]
    # Confidence ceiling implied by normalization quality (1.0 = clean).
    ceiling: float


def normalize_lab(
    test_name: str | None,
    value_raw: str | None,
    unit_raw: str | None,
    range_raw: str | None = None,
    flag_raw: str | None = None,
    measured_at: str | None = None,
) -> LabNormalization | None:
    """Normalize one raw lab row into the contract payload (None if there is no test name)."""
    name = clean(test_name)
    if not name:
        return None
    issues: list[str] = []
    ceiling = 1.0
    unit_raw = clean(unit_raw)
    value_text = clean(value_raw)

    numeric = parse_number(value_text)
    qualitative = None
    if numeric is None and value_text and value_text.lower() in QUALITATIVE_RESULTS:
        qualitative = value_text.capitalize()
    elif numeric is None:
        issues.append("result value could not be read")
        ceiling = min(ceiling, 0.5)

    ref_low, ref_high = parse_reference_range(range_raw)
    test, how = catalog().lookup(name)

    value = numeric
    unit = unit_raw
    if test is None:
        issues.append(f"unrecognized test name '{name}'")
        ceiling = min(ceiling, 0.6)
    else:
        if how == "fuzzy":
            issues.append(f"test name '{name}' matched approximately to {test.name}")
            ceiling = min(ceiling, 0.8)
        unit = test.unit
        if numeric is not None:
            converted, problem = convert(test, numeric, unit_raw)
            if problem:
                issues.append(problem)
                ceiling = min(ceiling, 0.6)
                unit = unit_raw
                value = numeric
            else:
                value = converted
                if unit_raw is None:
                    issues.append(f"unit missing; assumed {test.unit}")
                    ceiling = min(ceiling, 0.8)
                # Reference range is printed in the same unit as the value.
                if ref_low is not None:
                    ref_low, _ = convert(test, ref_low, unit_raw)
                if ref_high is not None:
                    ref_high, _ = convert(test, ref_high, unit_raw)
                # Reports such as discharge summaries often print values without a
                # range; fall back to the catalog's typical adult range so the
                # value can still be flagged.
                if ref_low is None and ref_high is None:
                    ref_low, ref_high = test.ref_low, test.ref_high
                plaus_lo, plaus_hi = test.plausible_low, test.plausible_high
                if value is not None and (
                    (plaus_lo is not None and value < plaus_lo) or (plaus_hi is not None and value > plaus_hi)
                ):
                    issues.append(f"value {fmt_number(value)} {test.unit} is outside the plausible range")
                    ceiling = min(ceiling, 0.5)

    flag = compute_flag(value, ref_low, ref_high) or printed_flag(flag_raw)

    data = {
        "test_name_original": name,
        "canonical_code": test.code if test else None,
        "canonical_name": test.name if test else None,
        "value": fmt_number(value) if numeric is not None else None,
        "value_text": qualitative if numeric is None else None,
        "unit": unit,
        "value_original": numeric,  # number as printed; text results live in value_text
        "unit_original": unit_raw,
        "reference_low": fmt_number(ref_low),
        "reference_high": fmt_number(ref_high),
        "flag": flag,
        "measured_at": measured_at,
    }
    return LabNormalization(data=data, issues=issues, ceiling=ceiling)
