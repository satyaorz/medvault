"""Evaluate OCR → classify → extract against the labelled synthetic dataset.

    python -m eval.run_eval --provider rules
    python -m eval.run_eval --provider ollama --limit 6

Metrics
  * classification accuracy, document-date accuracy
  * lab results:   P/R/F1 — match on canonical_code and value within 2 %
  * medications:   P/R/F1 — match on canonical_key + dose_value + dose_unit + frequency_code
                   (also a lenient "name only" recall)
  * auto-accept precision — of items the worker would auto-accept (conf ≥ 0.85, grounded,
    no issues), how many are correct? This validates the human-in-the-loop threshold.
  * breakdown by file format (text PDF / scanned PDF / phone photo / screenshot)
"""

from __future__ import annotations

import argparse
import json
import os
import time
from collections import defaultdict
from pathlib import Path

from app.extract.pipeline import classify, extract
from app.ocr import run_ocr

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "dataset"
RESULTS = ROOT / "results"
AUTO_ACCEPT = 0.85


def _close(a: float | None, b: float | None, tol: float = 0.02) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= max(tol * abs(b), 1e-6)


def _match_labs(pred: list[dict], truth: list[dict]) -> tuple[int, int, int, set[int]]:
    used: set[int] = set()
    correct_pred: set[int] = set()
    tp = 0
    for t in truth:
        for i, p in enumerate(pred):
            if i in used:
                continue
            if p["canonical_code"] == t["canonical_code"] and _close(p["value"], t["value"]):
                used.add(i)
                correct_pred.add(i)
                tp += 1
                break
    return tp, len(pred) - tp, len(truth) - tp, correct_pred


def _med_key(m: dict) -> tuple:
    dose = None if m.get("dose_value") is None else round(float(m["dose_value"]), 3)
    return m["canonical_key"], dose, (m.get("dose_unit") or None), m.get("frequency_code")


def _match_meds(pred: list[dict], truth: list[dict]) -> tuple[int, int, int, int, set[int]]:
    used: set[int] = set()
    correct_pred: set[int] = set()
    tp = 0
    for t in truth:
        for i, p in enumerate(pred):
            if i not in used and _med_key(p) == _med_key(t):
                used.add(i)
                correct_pred.add(i)
                tp += 1
                break
    names_pred = [p["canonical_key"] for p in pred]
    name_hits = sum(1 for t in truth if t["canonical_key"] in names_pred)
    return tp, len(pred) - tp, len(truth) - tp, name_hits, correct_pred


def prf(tp: int, fp: int, fn: int) -> dict:
    precision = tp / (tp + fp) if tp + fp else (1.0 if fn == 0 else 0.0)
    recall = tp / (tp + fn) if tp + fn else 1.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": round(precision, 3), "recall": round(recall, 3), "f1": round(f1, 3), "tp": tp, "fp": fp, "fn": fn}


def evaluate(provider: str, limit: int | None = None, ids: list[str] | None = None) -> dict:
    os.environ["LLM_PROVIDER"] = provider
    manifest = json.loads((DATASET / "manifest.json").read_text())
    if ids:
        manifest = [m for m in manifest if m["id"] in ids]
    if limit:
        # spread the subset across document types
        by_type = defaultdict(list)
        for m in manifest:
            by_type[m["doc_type"]].append(m)
        subset = []
        while len(subset) < limit and any(by_type.values()):
            for doc_type in list(by_type):
                if by_type[doc_type] and len(subset) < limit:
                    subset.append(by_type[doc_type].pop(0))
        manifest = subset

    totals = defaultdict(int)
    per_format = defaultdict(lambda: defaultdict(int))
    docs = []
    latencies = []
    providers_used = defaultdict(int)
    for entry in manifest:
        truth = json.loads((DATASET / f"{entry['id']}.truth.json").read_text())
        data = (DATASET / entry["file"]).read_bytes()
        started = time.perf_counter()
        ocr = run_ocr(data)
        cls = classify(ocr.text, requested_provider=provider)
        result = extract(ocr.text, cls.doc_type, ocr_confidence=ocr.mean_confidence, provider_name=provider)
        elapsed = time.perf_counter() - started
        latencies.append(elapsed)
        providers_used[result.provider] += 1

        labs = [it for it in result.items if it.kind == "lab_result"]
        meds = [it for it in result.items if it.kind == "medication"]
        l_tp, l_fp, l_fn, l_ok = _match_labs([it.data for it in labs], truth["labs"])
        m_tp, m_fp, m_fn, m_names, m_ok = _match_meds([it.data for it in meds], truth["medications"])

        auto_total = auto_correct = 0
        for group, ok in ((labs, l_ok), (meds, m_ok)):
            for i, item in enumerate(group):
                if item.confidence >= AUTO_ACCEPT and item.grounded and not item.issues:
                    auto_total += 1
                    auto_correct += i in ok

        cls_ok = cls.doc_type == truth["doc_type"]
        date_ok = result.document.date == truth["date"]
        fmt = entry["format"]
        for bucket in (totals, per_format[fmt]):
            bucket["docs"] += 1
            bucket["cls_ok"] += cls_ok
            bucket["date_ok"] += date_ok
            bucket["lab_tp"] += l_tp
            bucket["lab_fp"] += l_fp
            bucket["lab_fn"] += l_fn
            bucket["med_tp"] += m_tp
            bucket["med_fp"] += m_fp
            bucket["med_fn"] += m_fn
            bucket["med_name_hits"] += m_names
            bucket["med_truth"] += len(truth["medications"])
            bucket["auto_total"] += auto_total
            bucket["auto_correct"] += auto_correct
            bucket["items"] += len(labs) + len(meds)
        docs.append({
            "id": entry["id"], "format": fmt, "provider": result.provider, "seconds": round(elapsed, 2),
            "ocr_method": ocr.method, "ocr_confidence": ocr.mean_confidence,
            "doc_type": cls.doc_type, "doc_type_truth": truth["doc_type"], "classify_method": cls.method,
            "date": result.document.date, "date_truth": truth["date"],
            "labs": {"tp": l_tp, "fp": l_fp, "fn": l_fn}, "meds": {"tp": m_tp, "fp": m_fp, "fn": m_fn},
            "auto_accepted": auto_total, "auto_accepted_correct": auto_correct,
        })
        print(f"  {entry['id']:<24} {fmt:<14} {result.provider:<8} {elapsed:6.1f}s  type={'ok ' if cls_ok else 'BAD'} "
              f"date={'ok ' if date_ok else 'BAD'} labs {l_tp}/{l_tp + l_fn} (+{l_fp} fp)  meds {m_tp}/{m_tp + m_fn} (+{m_fp} fp)",
              flush=True)

    def summary(b: dict) -> dict:
        return {
            "documents": b["docs"],
            "classification_accuracy": round(b["cls_ok"] / b["docs"], 3) if b["docs"] else None,
            "date_accuracy": round(b["date_ok"] / b["docs"], 3) if b["docs"] else None,
            "labs": prf(b["lab_tp"], b["lab_fp"], b["lab_fn"]),
            "medications": prf(b["med_tp"], b["med_fp"], b["med_fn"]),
            "medication_name_recall": round(b["med_name_hits"] / b["med_truth"], 3) if b["med_truth"] else None,
            "auto_accept_rate": round(b["auto_total"] / b["items"], 3) if b["items"] else None,
            "auto_accept_precision": round(b["auto_correct"] / b["auto_total"], 3) if b["auto_total"] else None,
        }

    report = {
        "provider": provider,
        "providers_used": dict(providers_used),
        "mean_seconds_per_document": round(sum(latencies) / len(latencies), 2) if latencies else None,
        "overall": summary(totals),
        "by_format": {fmt: summary(b) for fmt, b in sorted(per_format.items())},
        "documents": docs,
    }
    return report


def markdown(report: dict) -> str:
    rows = [("overall", report["overall"])] + list(report["by_format"].items())
    lines = [
        f"### Provider: `{report['provider']}` (used: {report['providers_used']}), "
        f"mean {report['mean_seconds_per_document']} s/doc",
        "",
        "| slice | docs | type acc | date acc | lab P | lab R | lab F1 | med P | med R | med F1 | med name R | auto-accept rate | auto-accept precision |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for name, s in rows:
        lines.append(
            f"| {name} | {s['documents']} | {s['classification_accuracy']} | {s['date_accuracy']} | "
            f"{s['labs']['precision']} | {s['labs']['recall']} | {s['labs']['f1']} | "
            f"{s['medications']['precision']} | {s['medications']['recall']} | {s['medications']['f1']} | "
            f"{s['medication_name_recall']} | {s['auto_accept_rate']} | {s['auto_accept_precision']} |"
        )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--provider", default="rules", choices=["rules", "ollama", "anthropic"])
    parser.add_argument("--limit", type=int, default=None, help="evaluate a type-balanced subset of N documents")
    parser.add_argument("--ids", nargs="*", help="only these document ids")
    args = parser.parse_args()
    report = evaluate(args.provider, args.limit, args.ids)
    RESULTS.mkdir(exist_ok=True)
    report["subset_limit"] = args.limit
    (RESULTS / f"{args.provider}.json").write_text(json.dumps(report, indent=2))
    table = markdown(report)
    (RESULTS / f"{args.provider}.md").write_text(table + "\n")
    print()
    print(table)


if __name__ == "__main__":
    main()
