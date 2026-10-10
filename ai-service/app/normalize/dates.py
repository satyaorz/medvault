"""Date parsing for Indian medical documents (DD/MM/YYYY is the default convention)."""

from __future__ import annotations

import re
from datetime import date, timedelta

MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4,
    "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9, "oct": 10, "october": 10, "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}
_MON = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"

# Ordered: most specific first.
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b"), "ymd"),
    (re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]+" + _MON + r"[\s\-/.,']+(\d{4}|\d{2})\b", re.I), "d_mon_y"),
    (re.compile(r"\b" + _MON + r"[\s\-/.]+(\d{1,2})(?:st|nd|rd|th)?,?[\s\-/.]+(\d{4})\b", re.I), "mon_d_y"),
    (re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b"), "dmy"),
    (re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})\b(?![-/.]\d)"), "dmy2"),
]


def _year(y: str) -> int:
    value = int(y)
    if value < 100:
        value += 2000 if value < 70 else 1900
    return value


def _build(y: int, m: int, d: int) -> date | None:
    if not (1950 <= y <= 2100):
        return None
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _from_match(match: re.Match[str], kind: str) -> date | None:
    g = match.groups()
    if kind == "ymd":
        return _build(int(g[0]), int(g[1]), int(g[2]))
    if kind == "d_mon_y":
        return _build(_year(g[2]), MONTHS[g[1].lower()[:3]], int(g[0]))
    if kind == "mon_d_y":
        return _build(_year(g[2]), MONTHS[g[0].lower()[:3]], int(g[1]))
    if kind in ("dmy", "dmy2"):
        day, month, year = int(g[0]), int(g[1]), _year(g[2])
        parsed = _build(year, month, day)
        if parsed is None and month > 12 >= day:  # tolerate US-style MM/DD/YYYY when unambiguous
            parsed = _build(year, day, month)
        return parsed
    return None


def find_dates(text: str) -> list[tuple[int, int, date]]:
    """All dates in `text` as (start, end, date), in reading order, non-overlapping."""
    found: list[tuple[int, int, date]] = []
    taken: list[tuple[int, int]] = []
    for pattern, kind in _PATTERNS:
        for match in pattern.finditer(text):
            start, end = match.span()
            if any(start < t_end and end > t_start for t_start, t_end in taken):
                continue
            parsed = _from_match(match, kind)
            if parsed:
                found.append((start, end, parsed))
                taken.append((start, end))
    found.sort(key=lambda item: item[0])
    return found


def parse_date(raw: str | None) -> str | None:
    """First date found in `raw` as ISO 'YYYY-MM-DD', else None."""
    if not raw:
        return None
    dates = find_dates(str(raw))
    return dates[0][2].isoformat() if dates else None


_REL = re.compile(
    r"(?:after|in|within|next)\s+(\d+|one|two|three|four|six|a)\s*(day|week|wk|month|mon|year)s?", re.I
)
_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "six": 6, "a": 1}


def resolve_relative(raw: str | None, anchor: str | None) -> str | None:
    """'after 2 weeks' relative to an ISO anchor date → ISO date (None if not resolvable)."""
    if not raw or not anchor:
        return None
    match = _REL.search(raw)
    if not match:
        return None
    count_raw = match.group(1).lower()
    count = _WORDS.get(count_raw) or int(count_raw)
    unit = match.group(2).lower()
    days = {"day": 1, "week": 7, "wk": 7, "month": 30, "mon": 30, "year": 365}[unit] * count
    try:
        base = date.fromisoformat(anchor)
    except ValueError:
        return None
    return (base + timedelta(days=days)).isoformat()
