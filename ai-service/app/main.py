"""MedVault AI service — stateless OCR, classification and extraction (docs/CONTRACTS.md §2).

This service never touches the database: the Go worker validates its output and is the
only writer of medical data.
"""

from __future__ import annotations

import logging
import time

from fastapi import FastAPI, File, HTTPException, Request, UploadFile

from app.config import get_settings
from app.extract.pipeline import classify, extract, llm_status
from app.ocr import UnreadableFile, UnsupportedFileType, run_ocr
from app.schemas import (
    ClassifyRequest,
    ClassifyResponse,
    ExtractRequest,
    ExtractResponse,
    HealthResponse,
    OCRPage,
    OCRResponse,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("medvault.ai")

app = FastAPI(title="MedVault AI service", version="1.0.0")


@app.middleware("http")
async def access_log(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    log.info("%s %s -> %d (%.0f ms)", request.method, request.url.path, response.status_code,
             (time.perf_counter() - started) * 1000)
    return response


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", llm=llm_status())


@app.post("/ocr", response_model=OCRResponse)
def ocr(file: UploadFile = File(...)) -> OCRResponse:
    settings = get_settings()
    data = file.file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="file too large")
    if not data:
        raise HTTPException(status_code=422, detail="empty file")
    try:
        result = run_ocr(data)
    except UnsupportedFileType as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except UnreadableFile as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return OCRResponse(
        text=result.text,
        page_count=result.page_count,
        method=result.method,
        mean_confidence=result.mean_confidence,
        pages=[OCRPage(page=p.page, text=p.text, method=p.method, confidence=p.confidence) for p in result.pages],
    )


@app.post("/classify", response_model=ClassifyResponse)
def classify_endpoint(body: ClassifyRequest) -> ClassifyResponse:
    result = classify(body.text)
    return ClassifyResponse(doc_type=result.doc_type, confidence=result.confidence, method=result.method,
                            scores=result.scores)


@app.post("/extract", response_model=ExtractResponse)
def extract_endpoint(body: ExtractRequest) -> ExtractResponse:
    doc_type = body.doc_type if body.doc_type != "unknown" else classify(body.text).doc_type
    return extract(body.text, doc_type, ocr_confidence=body.ocr_confidence)
