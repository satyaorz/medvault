"""Provider interface shared by LLM back-ends."""

from __future__ import annotations

from typing import Protocol

from app.schemas import RawExtraction


class ProviderError(Exception):
    """An LLM call failed (network, timeout, invalid output). Callers fall back to rules."""


class LLMProvider(Protocol):
    name: str
    model: str | None

    def available(self) -> bool: ...

    def extract(self, text: str, doc_type: str) -> RawExtraction: ...

    def classify(self, text: str) -> str: ...
