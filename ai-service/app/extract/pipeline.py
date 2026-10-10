"""Extraction pipeline: provider → schema validation → normalization → grounding → confidence.

    raw  = LLM or rules extractor (fields "as written")
    data = normalize_lab / normalize_medication / ...   (deterministic, unit-tested)
    grounded = source_text found in OCR text?
    confidence = min(extractor confidence, normalization ceiling, grounding cap, OCR factor)
                 (+ boost when LLM and rules independently agree)

The Go worker auto-accepts items with confidence ≥ 0.85, grounded, and no issues.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

from app.classify import LLM_MARGIN, Classification, classify_rules
from app.config import Settings, get_settings
from app.extract.anthropic_provider import AnthropicProvider
from app.extract.ollama import OllamaProvider
from app.extract.rules import _NO_ALLERGY as NO_ALLERGY
from app.extract.rules import extract_rules
from app.normalize.dates import parse_date, resolve_relative
from app.normalize.grounding import GroundingIndex
from app.normalize.labs import normalize_lab
from app.normalize.medications import normalize_medication
from app.normalize.text import clean, norm_key
from app.schemas import DocumentMeta, ExtractedItem, ExtractResponse, RawExtraction

log = logging.getLogger(__name__)

LLM_BASE_CONFIDENCE = 0.88   # LLM item, not confirmed by rules
AGREEMENT_CONFIDENCE = 0.96  # LLM and rules found the same fact
UNGROUNDED_CAP = 0.4
CONFLICT_CAP = 0.7           # LLM and rules disagree on the same fact
LOW_OCR_THRESHOLD = 0.85

# ------------------------------------------------------------------ providers

_lock = threading.Lock()
_providers: dict[tuple, object] = {}


def _provider_for(name: str, settings: Settings):
    key = (name, settings.ollama_url, settings.ollama_model, settings.anthropic_model, bool(settings.anthropic_api_key))
    with _lock:
        if key not in _providers:
            if name == "ollama":
                _providers[key] = OllamaProvider(settings)
            elif name == "anthropic":
                _providers[key] = AnthropicProvider(settings)
            else:
                raise ValueError(name)
        return _providers[key]


def select_provider(settings: Settings | None = None, requested: str | None = None):
    """Resolve LLM_PROVIDER (auto|ollama|anthropic|rules) to a provider object or None (= rules)."""
    settings = settings or get_settings()
    choice = (requested or settings.llm_provider or "auto").lower()
    if choice == "rules":
        return None
    if choice in ("anthropic", "auto") and settings.anthropic_api_key:
        return _provider_for("anthropic", settings)
    if choice == "anthropic":
        log.warning("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set; using rules")
        return None
    if choice in ("ollama", "auto"):
        provider = _provider_for("ollama", settings)
        if provider.available():
            return provider
        if choice == "ollama":
            log.warning("Ollama model %s not reachable at %s; using rules", settings.ollama_model, settings.ollama_url)
    return None


def llm_status(settings: Settings | None = None) -> dict:
    settings = settings or get_settings()
    provider = select_provider(settings)
    if provider is None:
        return {"provider": "rules", "model": None, "available": settings.llm_provider == "rules"}
    return {"provider": provider.name, "model": provider.model, "available": True}


# ------------------------------------------------------------- classification


def classify(text: str, requested_provider: str | None = None) -> Classification:
    result = classify_rules(text)
    if result.margin >= LLM_MARGIN:
        return result
    provider = select_provider(requested=requested_provider)
    if provider is None:
        return result
    try:
        doc_type = provider.classify(text)
    except Exception as exc:  # noqa: BLE001 - never fail classification on LLM errors
        log.warning("LLM classification failed, keeping rules result: %s", exc)
        return result
    confidence = max(0.7, result.scores.get(doc_type, 0.0))
    return Classification(doc_type=doc_type, confidence=round(confidence, 3), scores=result.scores, method="llm")


# ----------------------------------------------------------------- extraction


@dataclass
class _Candidate:
    kind: str
    data: dict
    source_text: str | None
    base: float
    ceiling: float
    issues: list[str]
    key: str  # identity + value: equal keys mean "the same fact"

    @property
    def ident(self) -> str:
        """Identity without the value: equal idents with different keys mean "disagreement"."""
        return self.key.rsplit("|", 1)[0] if self.kind in ("lab_result", "medication") else self.key

    def summary(self) -> str:
        d = self.data
        if self.kind == "lab_result":
            return f"{d.get('value') if d.get('value') is not None else d.get('value_text')} {d.get('unit') or ''}".strip()
        if self.kind == "medication":
            return " ".join(str(x) for x in (d.get("dose_value"), d.get("dose_unit"), d.get("frequency_code")) if x)
        return str(d)


def _lab_candidates(raw: RawExtraction, base_default: float) -> list[_Candidate]:
    out = []
    for lab in raw.lab_results:
        norm = normalize_lab(lab.test_name_as_written, lab.value_as_written, lab.unit_as_written,
                             lab.reference_range_as_written, lab.flag_as_written)
        if norm is None:
            continue
        key_code = norm.data["canonical_code"] or "raw:" + norm_key(norm.data["test_name_original"])
        key = f"lab|{key_code}|{norm.data['value'] if norm.data['value'] is not None else norm.data['value_text']}"
        out.append(_Candidate("lab_result", norm.data, lab.source_text, lab.extractor_confidence or base_default,
                              norm.ceiling, norm.issues, key))
    return out


def _med_candidates(raw: RawExtraction, base_default: float) -> list[_Candidate]:
    out = []
    for med in raw.medications:
        norm = normalize_medication(med.name_as_written, med.strength_as_written, med.form_as_written,
                                    med.schedule_as_written, med.duration_as_written, med.instructions)
        if norm is None:
            continue
        key = f"med|{norm.data['canonical_key']}|{norm.data['dose_value']}:{norm.data['frequency_code']}"
        out.append(_Candidate("medication", norm.data, med.source_text, med.extractor_confidence or base_default,
                              norm.ceiling, norm.issues, key))
    return out


_DX_STATUS = {"active": "active", "resolved": "resolved", "suspected": "suspected", "provisional": "suspected",
              "chronic": "active", "known": "active", "old": "resolved", "history": "resolved"}


def _other_candidates(raw: RawExtraction, base_default: float, anchor_date: str | None) -> list[_Candidate]:
    out = []
    for dx in raw.diagnoses:
        name = clean(dx.name)
        if not name:
            continue
        status_raw = (dx.status_as_written or "").lower()
        status = next((v for k, v in _DX_STATUS.items() if k in status_raw), None) or ("active" if not status_raw else None)
        out.append(_Candidate("diagnosis", {"name": name, "status": status}, dx.source_text,
                              dx.extractor_confidence or base_default, 1.0, [], f"dx|{norm_key(name)}"))
    for allergy in raw.allergies:
        substance = clean(allergy.substance)
        if not substance or NO_ALLERGY.search(substance):  # "NKDA" is not an allergy
            continue
        out.append(_Candidate("allergy", {"substance": substance, "reaction": clean(allergy.reaction)},
                              allergy.source_text, allergy.extractor_confidence or base_default, 1.0, [],
                              f"allergy|{norm_key(substance)}"))
    for enc in raw.encounters:
        kind = (enc.type or "").lower().replace("-", "_").replace(" ", "_")
        if kind not in {"visit", "admission", "discharge", "follow_up"}:
            continue
        issues: list[str] = []
        ceiling = 1.0
        date = parse_date(enc.date_as_written)
        if date is None and enc.relative_as_written:
            date = resolve_relative(enc.relative_as_written, anchor_date)
            if date:
                issues.append(f"date computed from '{clean(enc.relative_as_written)}' relative to the document date")
                ceiling = 0.8
        if date is None and kind != "follow_up":
            date = anchor_date
        data = {"type": kind, "date": date, "facility": clean(enc.facility), "doctor": clean(enc.doctor),
                "notes": clean(enc.notes)}
        out.append(_Candidate("encounter", data, enc.source_text, enc.extractor_confidence or base_default,
                              ceiling, issues, f"enc|{kind}|{date}"))
    return out


def _candidates(raw: RawExtraction, base_default: float, anchor_date: str | None) -> list[_Candidate]:
    return _lab_candidates(raw, base_default) + _med_candidates(raw, base_default) + \
        _other_candidates(raw, base_default, anchor_date)


def _document_meta(raw: RawExtraction, fallback: RawExtraction | None) -> DocumentMeta:
    doc = raw.document
    fb = fallback.document if fallback else None
    date = parse_date(doc.date_as_written) or (parse_date(fb.date_as_written) if fb else None)
    return DocumentMeta(
        date=date,
        facility=clean(doc.facility) or (clean(fb.facility) if fb else None),
        doctor=clean(doc.doctor) or (clean(fb.doctor) if fb else None),
        patient_name=clean(doc.patient_name) or (clean(fb.patient_name) if fb else None),
    )


_FOCUS_KINDS = {
    "lab_report": {"lab_result", "diagnosis", "encounter"},
    "prescription": {"medication", "diagnosis", "allergy", "encounter", "lab_result"},
    "discharge_summary": {"lab_result", "medication", "diagnosis", "allergy", "encounter"},
    "other": {"lab_result", "diagnosis", "allergy", "encounter"},
}


TOKENS_PER_FACT = 22
TOKENS_FIXED = 90


def _within_budget(provider, rules_raw: RawExtraction) -> bool:
    """Adaptive routing: skip a slow local LLM when it can't finish within the budget.

    The rules pass tells us roughly how many facts the document holds; each costs ~22
    generated tokens in the compact row format.
    """
    estimate = getattr(provider, "estimate_seconds", None)
    if estimate is None:
        return True
    facts = (len(rules_raw.lab_results) + len(rules_raw.medications) + len(rules_raw.diagnoses)
             + len(rules_raw.allergies) + len(rules_raw.encounters))
    seconds = estimate(TOKENS_FIXED + TOKENS_PER_FACT * max(facts, 3))
    budget = get_settings().llm_budget_seconds
    if seconds > budget:
        log.info("%s skipped: ~%.0f s estimated for %d facts exceeds the %.0f s budget", provider.name, seconds,
                 facts, budget)
        return False
    return True


def extract(text: str, doc_type: str, ocr_confidence: float = 1.0, provider_name: str | None = None) -> ExtractResponse:
    """Run the full extraction pipeline for one document's OCR text."""
    doc_type = doc_type if doc_type in _FOCUS_KINDS else "other"
    rules_raw = extract_rules(text, doc_type)
    provider = select_provider(requested=provider_name)

    used_provider, model, raw = "rules", None, rules_raw
    if provider is not None and not _within_budget(provider, rules_raw):
        provider = None
    if provider is not None:
        try:
            raw = provider.extract(text, doc_type)
            used_provider, model = provider.name, provider.model
        except Exception as exc:  # noqa: BLE001 - any LLM failure → deterministic fallback
            log.warning("%s extraction failed, falling back to rules: %s", provider.name, exc)
            raw = rules_raw

    document = _document_meta(raw, rules_raw if raw is not rules_raw else None)
    llm_mode = used_provider != "rules"
    candidates = _candidates(raw, LLM_BASE_CONFIDENCE if llm_mode else 0.85, document.date)

    # Ensemble with the rules pass: agreement raises confidence, disagreement on the same
    # fact (e.g. a different value for the same test) sends it to human review, and facts
    # only the rules found are kept with the rules' own confidence.
    agreed: set[str] = set()
    conflicts: dict[str, str] = {}
    if llm_mode:
        rules_cands = _candidates(rules_raw, 0.85, document.date)
        rules_keys = {c.key for c in rules_cands}
        rules_by_ident: dict[str, list[_Candidate]] = {}
        for rc in rules_cands:
            rules_by_ident.setdefault(rc.ident, []).append(rc)
        llm_keys = {c.key for c in candidates}
        llm_idents = {c.ident for c in candidates}
        for cand in candidates:
            if cand.key in rules_keys:
                agreed.add(cand.key)
            elif cand.ident in rules_by_ident:
                other = rules_by_ident[cand.ident][0]
                conflicts[cand.key] = other.summary()
        candidates = candidates + [rc for rc in rules_cands if rc.key not in llm_keys and rc.ident not in llm_idents]

    index = GroundingIndex(text)
    items: list[ExtractedItem] = []
    seen: set[str] = set()
    allowed = _FOCUS_KINDS[doc_type]
    for cand in candidates:
        if cand.kind not in allowed or cand.key in seen:
            continue
        seen.add(cand.key)
        issues = list(cand.issues)
        confidence = cand.base
        if llm_mode and cand.key in agreed:
            confidence = AGREEMENT_CONFIDENCE
        if cand.key in conflicts:
            issues.append(f"the rule-based parser read a different value ({conflicts[cand.key]})")
            confidence = min(confidence, CONFLICT_CAP)
        confidence = min(confidence, cand.ceiling)

        grounded, _score = index.grounded(cand.source_text)
        if not cand.source_text:
            issues.append("no source text was given for this item")
        elif not grounded:
            issues.append("source text not found in the document")
        if not grounded:
            confidence = min(confidence, UNGROUNDED_CAP)

        if ocr_confidence < LOW_OCR_THRESHOLD:
            confidence *= max(ocr_confidence, 0.3) / LOW_OCR_THRESHOLD
            issues.append(f"low OCR quality ({round(ocr_confidence * 100)}%)")

        if cand.kind == "lab_result" and cand.data.get("measured_at") is None and document.date:
            cand.data["measured_at"] = document.date

        items.append(ExtractedItem(
            kind=cand.kind,
            data=_nullify(cand.data),
            source_text=clean(cand.source_text),
            confidence=round(max(0.0, min(confidence, 0.99)), 3),
            grounded=grounded,
            issues=issues,
        ))

    return ExtractResponse(doc_type=doc_type, provider=used_provider, model=model, document=document, items=items)


def _nullify(data: dict) -> dict:
    """Contract: unknown values are null, never empty strings."""
    return {k: (None if isinstance(v, str) and not v.strip() else v) for k, v in data.items()}

