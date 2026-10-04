"""Small text/number helpers shared by the normalizers and the rules extractor."""

from __future__ import annotations

import re

_WS = re.compile(r"\s+")
_DASHES = str.maketrans({"–": "-", "—": "-", "−": "-", "‐": "-", "‑": "-"})

# Words that describe a non-numeric lab result.
QUALITATIVE_RESULTS = {
    "positive", "negative", "reactive", "non-reactive", "nonreactive", "non reactive",
    "present", "absent", "nil", "trace", "detected", "not detected", "normal", "abnormal",
}


def clean(value: str | None) -> str | None:
    """Collapse whitespace; return None for empty strings (contract: null, not "")."""
    if value is None:
        return None
    value = _WS.sub(" ", str(value).translate(_DASHES)).strip(" \t\r\n:;,")
    return value or None


def norm_key(value: str) -> str:
    """Lowercase alphanumeric key used for dictionary lookups."""
    value = value.translate(_DASHES).lower()
    value = re.sub(r"[^a-z0-9%+]+", " ", value)
    return _WS.sub(" ", value).strip()


_NUM = re.compile(r"[-+]?\d[\d,]*(?:\.\d+)?|[-+]?\.\d+")


def parse_number(raw: str | None) -> float | None:
    """Parse a printed number: '13.5', '1,50,000' (Indian grouping), '2.5 lakh', '<0.5'.

    Returns None when no number is present. A comparison prefix ('<', '>') is dropped;
    callers keep the original text for display.
    """
    if raw is None:
        return None
    text = str(raw).translate(_DASHES).strip().lower()
    text = text.replace("½", "0.5")
    match = _NUM.search(text)
    if not match:
        return None
    token = match.group(0).replace(",", "")
    try:
        number = float(token)
    except ValueError:
        return None
    rest = text[match.end():]
    if re.match(r"\s*(lakh|lac)s?\b", rest):
        number *= 100_000
    return number


def fmt_number(value: float | None) -> float | None:
    """Round to a sensible number of significant digits for storage/display."""
    if value is None:
        return None
    if value == 0:
        return 0.0
    magnitude = abs(value)
    if magnitude >= 100:
        return round(value, 1)
    if magnitude >= 1:
        return round(value, 2)
    return round(value, 3)


def title_case(name: str) -> str:
    """Title-case a medicine/test name, keeping short all-caps tokens (e.g. 'D3', 'XR')."""
    words = []
    for word in name.split():
        if len(word) <= 3 and word.isupper():
            words.append(word)
        elif any(ch.isdigit() for ch in word):
            words.append(word.upper() if len(word) <= 4 else word.capitalize())
        else:
            words.append(word[:1].upper() + word[1:].lower())
    return " ".join(words)


_OCR_SHAPES = str.maketrans({"1": "l", "i": "l", "|": "l", "!": "l", "0": "o"})


def ocr_shape(key: str) -> str:
    """Collapse characters OCR commonly confuses (l/1/i, O/0, rn/m) for tolerant matching."""
    return key.replace("rn", "m").translate(_OCR_SHAPES)
