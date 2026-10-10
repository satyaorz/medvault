import io

import pymupdf
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

from app.main import app
from app.ocr import UnsupportedFileType, run_ocr, sniff_type
from tests.conftest import LAB_REPORT, PRESCRIPTION

client = TestClient(app)


def _text_pdf(lines: list[str]) -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    y = 60
    for line in lines:
        x = 50
        for cell in line.split("  "):  # double space → next column
            page.insert_text((x, y), cell, fontsize=10)
            x += 150
        y += 16
    data = doc.tobytes()
    doc.close()
    return data


def _image_png(lines: list[str], rotate: float = 0.0) -> bytes:
    img = Image.new("L", (1700, 120 + 70 * len(lines)), 255)
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 40)
    except OSError:
        font = ImageFont.load_default(size=40)
    for i, line in enumerate(lines):
        draw.text((60, 60 + 70 * i), line, fill=0, font=font)
    if rotate:
        img = img.rotate(rotate, expand=True, fillcolor=255)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_sniff_type():
    assert sniff_type(b"%PDF-1.7 ...") == "pdf"
    assert sniff_type(b"\x89PNG\r\n\x1a\n....") == "png"
    assert sniff_type(b"\xff\xd8\xff\xe0") == "jpeg"
    with pytest.raises(UnsupportedFileType):
        sniff_type(b"PK\x03\x04 zip")


def test_text_layer_pdf_keeps_table_rows_on_one_line():
    pdf = _text_pdf(["Hemoglobin  13.5  g/dL  13.0 - 17.0", "Platelet Count  250  10^3/uL  150 - 410",
                     "Reported On: 21/05/2026 and some more words to pass the threshold"])
    result = run_ocr(pdf)
    assert result.method == "text_layer" and result.mean_confidence == 1.0
    assert "Hemoglobin  13.5  g/dL  13.0 - 17.0" in result.text


def test_image_ocr_with_tesseract_and_deskew():
    png = _image_png(["Hemoglobin 13.5 g/dL 13.0 - 17.0", "Serum Creatinine 1.1 mg/dL 0.7 - 1.3"], rotate=1.5)
    result = run_ocr(png)
    assert result.method == "tesseract"
    assert result.mean_confidence > 0.7
    text = result.text.lower()
    assert "hemoglobin" in text and "creatinine" in text
    # each table row should survive as one line after deskew
    assert any("hemoglobin" in line and "13.5" in line for line in text.splitlines())


def test_scanned_pdf_falls_back_to_tesseract():
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_image(page.rect, stream=_image_png(["Total Cholesterol 182 mg/dL < 200"]))
    result = run_ocr(doc.tobytes())
    assert result.method == "tesseract"
    assert "cholesterol" in result.text.lower()


# ------------------------------------------------------------------------- API


def test_health_reports_rules_provider():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "llm": {"provider": "rules", "model": None, "available": True}}


def test_ocr_endpoint_rejects_unsupported_type():
    response = client.post("/ocr", files={"file": ("notes.txt", b"hello world", "text/plain")})
    assert response.status_code == 415


def test_ocr_endpoint_rejects_corrupt_pdf():
    response = client.post("/ocr", files={"file": ("broken.pdf", b"%PDF-1.4 garbage", "application/pdf")})
    assert response.status_code == 422


def test_ocr_endpoint_contract():
    pdf = _text_pdf(["CITYCARE DIAGNOSTICS", "Hemoglobin  13.5  g/dL  13.0 - 17.0", "Reported On: 21/05/2026"])
    body = client.post("/ocr", files={"file": ("r.pdf", pdf, "application/pdf")}).json()
    assert set(body) == {"text", "page_count", "method", "mean_confidence", "pages"}
    assert body["page_count"] == 1
    assert set(body["pages"][0]) == {"page", "text", "method", "confidence"}


def test_classify_endpoint():
    body = client.post("/classify", json={"text": LAB_REPORT}).json()
    assert body["doc_type"] == "lab_report" and body["method"] == "rules"
    assert set(body["scores"]) == {"prescription", "lab_report", "discharge_summary", "other"}


def test_extract_endpoint_contract():
    body = client.post("/extract", json={"text": PRESCRIPTION, "doc_type": "prescription"}).json()
    assert set(body) == {"doc_type", "provider", "model", "document", "items"}
    assert body["provider"] == "rules"
    assert set(body["document"]) == {"date", "facility", "doctor", "patient_name"}
    kinds = {item["kind"] for item in body["items"]}
    assert {"medication", "diagnosis", "allergy", "encounter"} <= kinds
    med = next(item for item in body["items"] if item["kind"] == "medication")
    assert set(med["data"]) == {"name_original", "generic_name", "brand_name", "canonical_key", "form", "dose_value",
                                "dose_unit", "frequency_code", "times_per_day", "schedule", "timing", "duration_days",
                                "instructions"}
    for item in body["items"]:
        assert 0 <= item["confidence"] <= 1
        assert all(value != "" for value in item["data"].values())


def test_extract_unknown_doc_type_is_classified_first():
    body = client.post("/extract", json={"text": LAB_REPORT, "doc_type": "unknown"}).json()
    assert body["doc_type"] == "lab_report"


def test_extract_rejects_invalid_doc_type():
    assert client.post("/extract", json={"text": "x", "doc_type": "xray"}).status_code == 422
