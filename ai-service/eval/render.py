"""Tiny document renderer used by the sample generators.

A document is a list of rows; each row is a list of (x, text) cells. Rows are drawn
top-down on an A4 page with PyMuPDF base-14 fonts, then optionally degraded into a
"scanned" PDF or a phone-photo JPEG / screenshot PNG for OCR testing.
"""

from __future__ import annotations

import io
import random
from dataclasses import dataclass, field

import pymupdf
from PIL import Image, ImageEnhance, ImageFilter

PAGE_W, PAGE_H = 595, 842
MARGIN_TOP = 50
BOTTOM_LIMIT = 800


@dataclass
class Row:
    cells: list[tuple[float, str]]
    size: float = 10
    bold: bool = False
    gap: float = 5  # extra space after the row


@dataclass
class Document:
    rows: list[Row] = field(default_factory=list)

    def text(self, text: str, x: float = 50, size: float = 10, bold: bool = False, gap: float = 5) -> None:
        self.rows.append(Row([(x, text)], size, bold, gap))

    def cols(self, cells: list[tuple[float, str]], size: float = 10, bold: bool = False, gap: float = 4) -> None:
        self.rows.append(Row(cells, size, bold, gap))

    def space(self, height: float = 8) -> None:
        self.rows.append(Row([], 1, False, height))

    def rule(self) -> None:
        self.rows.append(Row([(50, "_" * 86)], 9, False, 6))


def to_pdf(doc: Document) -> bytes:
    pdf = pymupdf.open()
    page = pdf.new_page(width=PAGE_W, height=PAGE_H)
    y = MARGIN_TOP
    for row in doc.rows:
        line_h = row.size * 1.25
        if y + line_h > BOTTOM_LIMIT:
            page = pdf.new_page(width=PAGE_W, height=PAGE_H)
            y = MARGIN_TOP
        for x, text in row.cells:
            if text:
                page.insert_text((x, y + row.size), text, fontname="hebo" if row.bold else "helv", fontsize=row.size)
        y += line_h + row.gap
    data = pdf.tobytes(deflate=True, garbage=3)
    pdf.close()
    return data


def _page_images(pdf_bytes: bytes, dpi: int) -> list[Image.Image]:
    images = []
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as pdf:
        for page in pdf:
            pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
            images.append(Image.frombytes("L", (pix.width, pix.height), pix.samples))
    return images


def _degrade(image: Image.Image, rng: random.Random, angle: float, blur: float, noise: int) -> Image.Image:
    img = image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=255)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    if noise:
        # light speckle, like dust on a scanner glass
        px = img.load()
        for _ in range(img.width * img.height // 900 * noise):
            x, y = rng.randrange(img.width), rng.randrange(img.height)
            px[x, y] = rng.choice((0, 110, 200))
    img = ImageEnhance.Contrast(img).enhance(rng.uniform(0.85, 1.0))
    return img


def to_scanned_pdf(pdf_bytes: bytes, rng: random.Random) -> bytes:
    """Image-only PDF (no text layer), like a flatbed scan."""
    out = pymupdf.open()
    for image in _page_images(pdf_bytes, dpi=200):
        img = _degrade(image, rng, angle=rng.uniform(-0.8, 0.8), blur=0.4, noise=1)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=70)
        page = out.new_page(width=PAGE_W, height=PAGE_H)
        page.insert_image(page.rect, stream=buf.getvalue())
    data = out.tobytes(deflate=True)
    out.close()
    return data


def to_photo_jpeg(pdf_bytes: bytes, rng: random.Random) -> bytes:
    """First page as a slightly rotated, blurred phone photo."""
    image = _page_images(pdf_bytes, dpi=170)[0]
    img = _degrade(image, rng, angle=rng.uniform(-2.0, 2.0), blur=0.7, noise=1)
    # uneven lighting: darken one side a little
    gradient = Image.linear_gradient("L").rotate(90).resize(img.size)
    img = Image.composite(img, ImageEnhance.Brightness(img).enhance(0.88), gradient)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=72)
    return buf.getvalue()


def to_screenshot_png(pdf_bytes: bytes) -> bytes:
    image = _page_images(pdf_bytes, dpi=150)[0]
    buf = io.BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
