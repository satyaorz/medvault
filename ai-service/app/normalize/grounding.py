"""Grounding check: does an extracted `source_text` really occur in the OCR text?

An LLM can "remember" values that are not on the page. Every item must point at a
verbatim snippet; we look for it (fuzzily, to tolerate OCR noise and whitespace) and
cap the confidence of anything we can't find.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

GROUNDING_THRESHOLD = 0.85
_DASHES = str.maketrans({"–": "-", "—": "-", "−": "-", "|": " "})


def _norm(text: str) -> str:
    text = re.sub(r"\s+", " ", text.translate(_DASHES).lower())
    return re.sub(r"\s*([-:/(),])\s*", r"\1", text).strip()


class GroundingIndex:
    """Pre-normalized document text, reused for every item in a document."""

    def __init__(self, document_text: str):
        self.text = _norm(document_text)
        self.tokens = self.text.split(" ") if self.text else []

    def score(self, snippet: str | None) -> float:
        if not snippet:
            return 0.0
        needle = _norm(snippet)
        if not needle:
            return 0.0
        if needle in self.text:
            return 1.0
        n_tokens = len(needle.split(" "))
        best = 0.0
        matcher = SequenceMatcher(autojunk=False)
        matcher.set_seq2(needle)
        for width in {max(1, n_tokens - 1), n_tokens, n_tokens + 1}:
            for start in range(0, max(1, len(self.tokens) - width + 1)):
                window = " ".join(self.tokens[start:start + width])
                matcher.set_seq1(window)
                if matcher.real_quick_ratio() < best or matcher.quick_ratio() < best:
                    continue
                ratio = matcher.ratio()
                if ratio > best:
                    best = ratio
                    if best >= 0.999:
                        return best
        return best

    def grounded(self, snippet: str | None) -> tuple[bool, float]:
        value = self.score(snippet)
        return value >= GROUNDING_THRESHOLD, value
