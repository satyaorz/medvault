"""Runtime configuration, read from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


@dataclass(frozen=True)
class Settings:
    # auto | ollama | anthropic | rules
    llm_provider: str
    ollama_url: str
    ollama_model: str
    ollama_timeout: float
    anthropic_api_key: str
    anthropic_model: str
    # Max OCR characters sent to an LLM; longer texts are trimmed (head + tail kept).
    llm_max_chars: int
    # Skip the local LLM (use rules) when its estimated runtime exceeds this budget.
    llm_budget_seconds: float
    max_upload_bytes: int
    max_pdf_pages: int
    tesseract_cmd: str
    tesseract_timeout: float

    @staticmethod
    def from_env() -> "Settings":
        return Settings(
            llm_provider=_env("LLM_PROVIDER", "auto").lower(),
            ollama_url=_env("OLLAMA_URL", "http://localhost:11434").rstrip("/"),
            ollama_model=_env("OLLAMA_MODEL", "llama3.1:8b"),
            ollama_timeout=float(_env("OLLAMA_TIMEOUT", "240")),
            anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", "").strip(),
            anthropic_model=_env("ANTHROPIC_MODEL", "claude-opus-5-5"),
            llm_max_chars=int(_env("LLM_MAX_CHARS", "12000")),
            llm_budget_seconds=float(_env("LLM_BUDGET_SECONDS", "180")),
            max_upload_bytes=int(_env("MAX_UPLOAD_MB", "25")) * 1024 * 1024,
            max_pdf_pages=int(_env("MAX_PDF_PAGES", "30")),
            tesseract_cmd=_env("TESSERACT_CMD", "tesseract"),
            tesseract_timeout=float(_env("TESSERACT_TIMEOUT", "120")),
        )


def get_settings() -> Settings:
    # Read on every call so tests (and operators) can change env vars without restarts.
    return Settings.from_env()
