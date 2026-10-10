"""Dosing-instruction parser for Indian prescription shorthand.

Examples
    "1-0-1 x 5 days"          → BD, 2/day, schedule 1-0-1, 5 days
    "1-0-0 BF x 7 days"       → OD, before_food, 7 days
    "OD"                      → OD
    "½-0-½ AF for 2 weeks"    → BD, after_food, 14 days
    "SOS"                     → SOS
The schedule notation is morning-afternoon-night (optionally a 4th slot).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_SLOT = r"(?:1/2|½|0\.5|[0-3])"
# Optional 4th slot only when written tightly ("1-0-1-0"); "1-0-1 - 3 days" is a duration.
_SCHEDULE = re.compile(
    rf"(?<![\d./])({_SLOT})\s*[-–—]\s*({_SLOT})\s*[-–—]\s*({_SLOT})"
    rf"(?:[-–—]({_SLOT})(?!\s*(?:days?|d|weeks?|wks?|w|months?)\b))?(?![\d./])",
    re.I,
)

# (pattern, frequency code, times per day). Checked in order; first match wins.
_CODES: list[tuple[re.Pattern[str], str, int | None]] = [
    (re.compile(r"\b(stat|immediately)\b", re.I), "STAT", None),
    (re.compile(r"\b(sos|prn|as needed|as required|when required|if required|if needed|when needed)\b", re.I), "SOS", None),
    (re.compile(r"\b(weekly|once a week|once weekly|every week)\b", re.I), "WEEKLY", None),
    (re.compile(r"\b(qid|q\.i\.d\.?|four times(?: a day| daily)?|4 times(?: a day| daily)?)\b", re.I), "QID", 4),
    (re.compile(r"\b(tds|tid|t\.d\.s\.?|t\.i\.d\.?|thrice(?: a day| daily)?|three times(?: a day| daily)?|3 times(?: a day| daily)?)\b", re.I), "TDS", 3),
    (re.compile(r"\b(bd|bid|b\.d\.?|b\.i\.d\.?|twice(?: a day| daily)?|two times(?: a day| daily)?|2 times(?: a day| daily)?|12 hourly|q12h)\b", re.I), "BD", 2),
    (re.compile(r"\b(hs|h\.s\.?|at bed ?time|bedtime|at night|night only)\b", re.I), "HS", 1),
    (re.compile(r"\b(od|o\.d\.?|qd|once(?: a day| daily)?|daily|every day|1 time a day|24 hourly)\b", re.I), "OD", 1),
]

_TIMING: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(bf|b/f|ac|a\.c\.|before (?:food|meals?|breakfast|lunch|dinner)|empty stomach|on empty stomach)\b", re.I), "before_food"),
    (re.compile(r"\b(af|a/f|pc|p\.c\.|after (?:food|meals?|breakfast|lunch|dinner))\b", re.I), "after_food"),
    (re.compile(r"\b(with (?:food|meals?|milk))\b", re.I), "with_food"),
    (re.compile(r"\b(hs|h\.s\.|at bed ?time|bedtime)\b", re.I), "bedtime"),
]

_DURATION = re.compile(
    r"(?:\b(?:x|for)\s*|×\s*|\(\s*|\b)(\d{1,3})\s*(days?|d|weeks?|wks?|w|months?|mths?|mon)\b", re.I
)
_UNIT_DAYS = {"d": 1, "day": 1, "days": 1, "w": 7, "wk": 7, "wks": 7, "week": 7, "weeks": 7,
              "month": 30, "months": 30, "mth": 30, "mths": 30, "mon": 30}

_FREQ_FROM_COUNT = {1: "OD", 2: "BD", 3: "TDS", 4: "QID"}


@dataclass
class Dosing:
    frequency_code: str | None = None
    times_per_day: int | None = None
    schedule: str | None = None
    timing: str | None = None
    duration_days: int | None = None
    issues: list[str] = field(default_factory=list)


def _slot(token: str) -> str:
    return "½" if token in {"1/2", "0.5", "½"} else token


def parse_dosing(*parts: str | None) -> Dosing:
    """Parse schedule/frequency/timing/duration from any combination of text fragments."""
    text = " ".join(p for p in parts if p)
    result = Dosing()
    if not text.strip():
        return result

    schedule_match = _SCHEDULE.search(text)
    code_from_text: tuple[str, int | None] | None = None
    for pattern, code, per_day in _CODES:
        if pattern.search(text):
            code_from_text = (code, per_day)
            break

    if schedule_match:
        slots = [_slot(s) for s in schedule_match.groups() if s is not None]
        result.schedule = "-".join(slots)
        doses = sum(1 for s in slots if s not in {"0"})
        if doses:
            result.times_per_day = doses
            result.frequency_code = _FREQ_FROM_COUNT.get(doses)
        if code_from_text and code_from_text[0] in {*_FREQ_FROM_COUNT.values(), "HS"}:
            expected = code_from_text[1]
            if expected is not None and doses and expected != doses:
                result.issues.append(
                    f"schedule {result.schedule} conflicts with '{code_from_text[0]}' in the instructions"
                )
        elif code_from_text and code_from_text[0] in {"SOS", "STAT", "WEEKLY"}:
            result.frequency_code = code_from_text[0]
            result.times_per_day = None
    elif code_from_text:
        result.frequency_code, result.times_per_day = code_from_text

    for pattern, timing in _TIMING:
        if pattern.search(text):
            result.timing = timing
            break
    if result.timing is None and result.frequency_code == "HS":
        result.timing = "bedtime"

    duration = _DURATION.search(_SCHEDULE.sub(" ", text))
    if duration:
        count = int(duration.group(1))
        unit = duration.group(2).lower()
        days = count * _UNIT_DAYS.get(unit, _UNIT_DAYS.get(unit.rstrip("s"), 1))
        if 0 < days <= 3650:
            result.duration_days = days
    return result
