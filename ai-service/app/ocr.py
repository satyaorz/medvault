"""OCR: PDF text layer when present, Tesseract otherwise.

Lines are rebuilt from word boxes (both for PDF text layers and Tesseract TSV) so that
table rows such as `Hemoglobin   13.5   g/dL   13.0 - 17.0` stay on one line — the
extractors rely on that. Large horizontal gaps become two spaces (a column hint).
"""

from __future__ import annotations

import io
import logging
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import pymupdf
from PIL import Image, ImageFilter, ImageOps

from app.config import get_settings

log = logging.getLogger(__name__)

MIN_TEXT_LAYER_CHARS = 40
RASTER_DPI = 300


class UnsupportedFileType(Exception):
    pass


class UnreadableFile(Exception):
    pass


@dataclass
class PageText:
    page: int
    text: str
    method: str  # text_layer | tesseract
    confidence: float


@dataclass
class OCRResult:
    text: str
    page_count: int
    method: str  # text_layer | tesseract | mixed
    mean_confidence: float
    pages: list[PageText]


def sniff_type(data: bytes) -> str:
    if data.startswith(b"%PDF"):
        return "pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    raise UnsupportedFileType("only PDF, PNG, JPEG and WEBP files are supported")


def run_ocr(data: bytes) -> OCRResult:
    kind = sniff_type(data)
    if kind == "pdf":
        pages = _ocr_pdf(data)
    else:
        try:
            image = Image.open(io.BytesIO(data))
            image.load()
        except Exception as exc:  # noqa: BLE001 - Pillow raises many types
            raise UnreadableFile(f"could not decode image: {exc}") from exc
        text, conf = ocr_image(image)
        pages = [PageText(page=1, text=text, method="tesseract", confidence=conf)]

    methods = {p.method for p in pages}
    method = methods.pop() if len(methods) == 1 else "mixed"
    weights = [max(len(p.text), 1) for p in pages]
    mean = sum(p.confidence * w for p, w in zip(pages, weights)) / sum(weights) if pages else 0.0
    return OCRResult(
        text="\n\n".join(p.text for p in pages).strip(),
        page_count=len(pages),
        method=method if pages else "text_layer",
        mean_confidence=round(mean, 3),
        pages=pages,
    )


# ------------------------------------------------------------------------- PDF


def _ocr_pdf(data: bytes) -> list[PageText]:
    settings = get_settings()
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001
        raise UnreadableFile(f"could not open PDF: {exc}") from exc
    if doc.needs_pass:
        raise UnreadableFile("PDF is password protected")
    pages: list[PageText] = []
    with doc:
        if doc.page_count == 0:
            raise UnreadableFile("PDF has no pages")
        for number, page in enumerate(doc, start=1):
            if number > settings.max_pdf_pages:
                log.warning("PDF truncated at %d pages", settings.max_pdf_pages)
                break
            text = _pdf_page_lines(page)
            if _meaningful_chars(text) >= MIN_TEXT_LAYER_CHARS:
                pages.append(PageText(page=number, text=text, method="text_layer", confidence=1.0))
                continue
            pix = page.get_pixmap(dpi=RASTER_DPI, colorspace=pymupdf.csGRAY)
            image = Image.frombytes("L", (pix.width, pix.height), pix.samples)
            ocr_text, conf = ocr_image(image)
            pages.append(PageText(page=number, text=ocr_text, method="tesseract", confidence=conf))
    return pages


def _meaningful_chars(text: str) -> int:
    return sum(1 for ch in text if ch.isalnum())


def _pdf_page_lines(page: "pymupdf.Page") -> str:
    words = page.get_text("words")  # x0, y0, x1, y1, word, block, line, word_no
    boxes = [(w[0], w[1], w[2], w[3], w[4]) for w in words if w[4].strip()]
    return _lines_from_boxes(boxes)


def _lines_from_boxes(boxes: list[tuple[float, float, float, float, str]]) -> str:
    """Group word boxes into visual lines by vertical overlap, then order by x."""
    if not boxes:
        return ""
    boxes = sorted(boxes, key=lambda b: ((b[1] + b[3]) / 2, b[0]))
    lines: list[list[tuple[float, float, float, float, str]]] = []
    for box in boxes:
        mid = (box[1] + box[3]) / 2
        height = max(box[3] - box[1], 1.0)
        if lines:
            last = lines[-1]
            last_mid = sum((b[1] + b[3]) / 2 for b in last) / len(last)
            last_h = sum(b[3] - b[1] for b in last) / len(last)
            if abs(mid - last_mid) <= 0.5 * max(height, last_h):
                last.append(box)
                continue
        lines.append([box])
    out = []
    for line in lines:
        line.sort(key=lambda b: b[0])
        parts = [line[0][4]]
        avg_char = sum((b[2] - b[0]) / max(len(b[4]), 1) for b in line) / len(line)
        for prev, cur in zip(line, line[1:]):
            gap = cur[0] - prev[2]
            parts.append("  " if gap > 2.5 * avg_char else " ")
            parts.append(cur[4])
        out.append("".join(parts))
    return "\n".join(out)


# ------------------------------------------------------------------- Tesseract


def _prepare(image: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if image.mode not in ("L", "RGB"):
        background = Image.new("RGB", image.size, "white")
        if image.mode in ("RGBA", "LA", "P"):
            image = image.convert("RGBA")
            background.paste(image, mask=image.split()[-1])
            image = background
        else:
            image = image.convert("RGB")
    image = image.convert("L")
    # Tesseract is happiest with ~30px x-height; upscale small photos/screenshots.
    if image.width < 1600:
        factor = 1600 / image.width
        image = image.resize((int(image.width * factor), int(image.height * factor)), Image.Resampling.LANCZOS)
    # Remove scanner speckle / sensor noise, then straighten slightly rotated photos so
    # that table rows stay on one text line.
    image = image.filter(ImageFilter.MedianFilter(3))
    angle = estimate_skew(image)
    if abs(angle) >= 0.2:
        image = image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=255)
    return image


def estimate_skew(image: Image.Image, max_angle: float = 4.0, step: float = 0.25) -> float:
    """Projection-profile deskew: the rotation that makes text rows sharpest.

    For each candidate angle, rotate a small binarized copy and measure the variance of
    row darkness; aligned text lines give strongly alternating dark/light rows.
    """
    small = image.copy()
    small.thumbnail((900, 900))
    hist = small.histogram()
    total = sum(hist)
    mean_level = sum(i * h for i, h in enumerate(hist)) / max(total, 1)
    binary = small.point(lambda v: 255 if v < mean_level * 0.8 else 0)

    def sharpness(angle: float) -> float:
        rotated = binary.rotate(angle, resample=Image.Resampling.NEAREST, expand=False, fillcolor=0)
        column = rotated.resize((1, rotated.height), Image.Resampling.BOX)
        rows = list(column.get_flattened_data() if hasattr(column, "get_flattened_data") else column.getdata())
        avg = sum(rows) / len(rows)
        return sum((r - avg) ** 2 for r in rows) / len(rows)

    best_angle, best_score = 0.0, sharpness(0.0)
    angle = -max_angle
    while angle <= max_angle + 1e-9:
        if abs(angle) > 1e-9:
            score = sharpness(angle)
            if score > best_score * 1.02:
                best_angle, best_score = angle, score
        angle += step
    # refine around the best coarse angle
    for delta in (-0.125, 0.125):
        score = sharpness(best_angle + delta)
        if score > best_score:
            best_angle, best_score = best_angle + delta, score
    return best_angle


def ocr_image(image: Image.Image) -> tuple[str, float]:
    """Run Tesseract on a PIL image → (text, mean word confidence 0..1)."""
    settings = get_settings()
    prepared = _prepare(image)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "page.png"
        prepared.save(path)
        try:
            proc = subprocess.run(
                [settings.tesseract_cmd, str(path), "stdout", "--psm", "6", "-l", "eng", "tsv"],
                capture_output=True,
                text=True,
                timeout=settings.tesseract_timeout,
                check=False,
            )
        except FileNotFoundError as exc:
            raise RuntimeError("tesseract binary not found; install tesseract-ocr") from exc
        except subprocess.TimeoutExpired as exc:
            raise UnreadableFile("OCR timed out") from exc
    if proc.returncode != 0:
        raise UnreadableFile(f"tesseract failed: {proc.stderr.strip()[:200]}")
    return parse_tsv(proc.stdout)


def parse_tsv(tsv: str) -> tuple[str, float]:
    boxes: list[tuple[float, float, float, float, str]] = []
    confidences: list[float] = []
    lines = tsv.splitlines()
    if not lines:
        return "", 0.0
    header = lines[0].split("\t")
    col = {name: i for i, name in enumerate(header)}
    for row in lines[1:]:
        cells = row.split("\t")
        if len(cells) < len(header) or cells[col["level"]] != "5":
            continue
        word = cells[col["text"]].strip()
        try:
            conf = float(cells[col["conf"]])
        except ValueError:
            continue
        if not word or conf < 0:
            continue
        left, top = float(cells[col["left"]]), float(cells[col["top"]])
        width, height = float(cells[col["width"]]), float(cells[col["height"]])
        boxes.append((left, top, left + width, top + height, word))
        confidences.append(conf)
    if not boxes:
        return "", 0.0
    text = _lines_from_boxes(boxes)
    return text, round(sum(confidences) / len(confidences) / 100.0, 3)
