"""Document classification: transparent keyword scoring, with an LLM tie-breaker.

Rules are fast, explainable (each signal has a weight) and good enough for clear
documents. Only when the top two classes are close do we spend an LLM call.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from app.normalize.labs import catalog

# (pattern, weight) per class. Weights are additive evidence; counts are capped.
_SIGNALS: dict[str, list[tuple[re.Pattern[str], float, int]]] = {
    "prescription": [
        (re.compile(r"(^|\s)(rx|℞)\b", re.I | re.M), 3.0, 1),
        (re.compile(r"\b(tab|tablet|cap|capsule|syp|syrup|inj|drops)\b\.?", re.I), 1.0, 6),
        (re.compile(r"(?<![\d./])[01½]\s*-\s*[01½]\s*-\s*[01½](?![\d./])"), 1.2, 6),
        (re.compile(r"\b(od|bd|tds|tid|qid|hs|sos)\b", re.I), 0.6, 6),
        (re.compile(r"\b(prescription|prescribed|advice|advised|sig)\b", re.I), 1.0, 3),
        (re.compile(r"\b(x|for)\s*\d+\s*(days?|weeks?)\b", re.I), 0.8, 4),
        (re.compile(r"\b(reg\.?\s*no|registration no|mbbs|md|consultant|o\.?p\.?d)\b", re.I), 0.6, 3),
        (re.compile(r"\b(chief complaints?|c/o|follow[- ]?up|review after)\b", re.I), 0.6, 3),
    ],
    "lab_report": [
        (re.compile(r"\b(reference (range|interval|value)s?|biological reference|ref\.? range|normal range)\b", re.I), 3.0, 1),
        (re.compile(r"\b(investigations?|test name|result|units?|observed value)\b", re.I), 0.8, 5),
        (re.compile(r"\b(specimen|sample (type|collected|received)|collected on|reported on|barcode|pathology|laboratory|diagnostics)\b", re.I), 0.8, 5),
        (re.compile(r"\b(mg/dl|g/dl|mmol/l|u/l|iu/l|µiu/ml|uiu/ml|ng/ml|pg/ml|fl|/cumm|10\^3/µl|10\^3/ul)\b", re.I), 0.5, 10),
        (re.compile(r"\b(complete blood count|cbc|lipid profile|liver function|kidney function|thyroid profile|hba1c)\b", re.I), 1.0, 4),
    ],
    "discharge_summary": [
        (re.compile(r"\bdischarge summary\b", re.I), 4.0, 1),
        (re.compile(r"\b(date of admission|date of discharge|admitted on|discharged on|doa|dod)\b", re.I), 1.5, 4),
        (re.compile(r"\b(course in (the )?hospital|hospital course|condition at discharge|discharge (advice|medications?|instructions))\b", re.I), 1.5, 4),
        (re.compile(r"\b(ip ?no|ipd|ward|bed no|in-?patient|uhid)\b", re.I), 0.6, 4),
        (re.compile(r"\b(final diagnosis|procedures? done|treatment given)\b", re.I), 1.0, 3),
    ],
    "other": [
        (re.compile(r"\b(invoice|bill no|receipt|gst|amount|total amount|mrp|rate|qty|batch)\b", re.I), 0.9, 6),
        (re.compile(r"\b(vaccination|vaccine|immuni[sz]ation|dose \d)\b", re.I), 1.2, 4),
        (re.compile(r"\b(certificate|certify|fit to|medical fitness|insurance|claim)\b", re.I), 1.0, 4),
    ],
}

DOC_TYPES = ("prescription", "lab_report", "discharge_summary", "other")
_TEMPERATURE = 1.6
LLM_MARGIN = 0.2


@dataclass
class Classification:
    doc_type: str
    confidence: float
    scores: dict[str, float]
    method: str = "rules"

    @property
    def margin(self) -> float:
        ranked = sorted(self.scores.values(), reverse=True)
        return ranked[0] - (ranked[1] if len(ranked) > 1 else 0.0)


def _lab_name_hits(text: str) -> int:
    """Count lines that start with a known lab test name followed by a number."""
    hits = 0
    cat = catalog()
    for line in text.splitlines()[:300]:
        match = re.match(r"\s*([A-Za-z][A-Za-z0-9 .()\-/,%]{1,45}?)\s*[:\-]?\s+[<>]?\d", line)
        if match and cat.lookup(match.group(1))[0] is not None:
            hits += 1
    return hits


def classify_rules(text: str) -> Classification:
    evidence = {doc_type: 0.0 for doc_type in DOC_TYPES}
    for doc_type, signals in _SIGNALS.items():
        for pattern, weight, cap in signals:
            count = min(len(pattern.findall(text)), cap)
            evidence[doc_type] += weight * count
    evidence["lab_report"] += 0.8 * min(_lab_name_hits(text), 12)
    # A discharge summary also contains drugs and labs; give its explicit markers priority.
    if evidence["discharge_summary"] >= 4.0:
        evidence["prescription"] *= 0.5
        evidence["lab_report"] *= 0.5
    # "other" is the fallback when nothing medical stands out.
    total_medical = evidence["prescription"] + evidence["lab_report"] + evidence["discharge_summary"]
    if total_medical < 2.0:
        evidence["other"] += 2.0

    exp = {k: math.exp(v / _TEMPERATURE) for k, v in evidence.items()}
    norm = sum(exp.values())
    scores = {k: round(v / norm, 3) for k, v in exp.items()}
    best = max(scores, key=scores.get)
    return Classification(doc_type=best, confidence=scores[best], scores=scores)
