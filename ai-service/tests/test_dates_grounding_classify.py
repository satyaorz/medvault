import pytest

from app.classify import classify_rules
from app.normalize.dates import find_dates, parse_date, resolve_relative
from app.normalize.grounding import GroundingIndex
from tests.conftest import DISCHARGE, LAB_REPORT, PRESCRIPTION


@pytest.mark.parametrize(
    "raw, iso",
    [("12/01/2026", "2026-01-12"), ("12-01-2026", "2026-01-12"), ("12.01.2026", "2026-01-12"), ("2026-01-12", "2026-01-12"),
     ("12 Jan 2026", "2026-01-12"), ("12-Jan-2026", "2026-01-12"), ("Jan 12, 2026", "2026-01-12"),
     ("3rd March 2026", "2026-03-03"), ("12-Sept-2026", "2026-09-12"), ("12/01/26", "2026-01-12"),
     ("01/25/2026", "2026-01-25"),  # unambiguous US-style still parses
     ("31/02/2026", None), ("no date here", None), (None, None)],
)
def test_parse_date(raw, iso):
    assert parse_date(raw) == iso


def test_find_dates_in_order_without_overlap():
    dates = find_dates("Admitted 02/03/2026, discharged 05-Mar-2026.")
    assert [d.isoformat() for _, _, d in dates] == ["2026-03-02", "2026-03-05"]


@pytest.mark.parametrize(
    "raw, iso",
    [("Follow up after 2 weeks", "2026-02-03"), ("review in 3 months", "2026-04-20"), ("after one week", "2026-01-27"),
     ("as needed", None)],
)
def test_resolve_relative(raw, iso):
    assert resolve_relative(raw, "2026-01-20") == iso


def test_grounding_exact_and_fuzzy():
    index = GroundingIndex("HGB   136  g/L   130 - 170\nPlatelet Count 2.5 lakhs/cumm")
    assert index.grounded("HGB 136 g/L 130 - 170")[0]           # whitespace-insensitive
    assert index.grounded("HG8 136 g/L 130-170")[0]             # small OCR differences
    ok, score = index.grounded("Hemoglobin 15.9 g/dL")          # not on the page
    assert not ok and score < 0.85
    assert not index.grounded(None)[0]


@pytest.mark.parametrize("text, doc_type", [(LAB_REPORT, "lab_report"), (PRESCRIPTION, "prescription"),
                                            (DISCHARGE, "discharge_summary")])
def test_classify_rules(text, doc_type):
    result = classify_rules(text)
    assert result.doc_type == doc_type
    assert result.confidence > 0.6
    assert abs(sum(result.scores.values()) - 1.0) < 0.01


def test_classify_bill_as_other():
    bill = """SHREE GANESH MEDICAL STORES  GSTIN 27ABCDE
Bill No: SG/1234  Date: 16/08/2026
Item  Batch  Qty  MRP  Amount
Augmentin 625 Tab  B123  10  220.00  220.00
Total Amount: Rs. 220.00"""
    assert classify_rules(bill).doc_type == "other"


def test_classify_empty_text_is_other():
    assert classify_rules("").doc_type == "other"
