"""Ollama provider (local LLM, default llama3.1:8b) using native structured outputs."""

from __future__ import annotations

import json
import logging
import time

import httpx
from pydantic import ValidationError

from app.config import Settings
from app.extract.base import ProviderError
from app.extract.prompts import (
    CLASSIFY_PROMPT,
    CLASSIFY_SCHEMA,
    EXTRACTION_SCHEMA,
    SYSTEM_PROMPT,
    compact_to_raw,
    number_lines,
    trim_for_llm,
    user_prompt,
)
from app.schemas import RawExtraction

log = logging.getLogger(__name__)

_AVAILABILITY_TTL = 30.0


class OllamaProvider:
    name = "ollama"

    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None):
        self.settings = settings
        self.model = settings.ollama_model
        self._client = httpx.Client(base_url=settings.ollama_url, transport=transport, timeout=settings.ollama_timeout)
        self._available: tuple[float, bool] | None = None
        # Observed generation speed (tokens/s), exponential moving average. Laptop GPUs
        # that can't hold the whole model run an 8B model at ~5-6 tokens/s.
        self.tokens_per_second = 6.0

    def estimate_seconds(self, expected_output_tokens: int) -> float:
        return expected_output_tokens / max(self.tokens_per_second, 0.5) + 8.0

    def available(self) -> bool:
        now = time.monotonic()
        if self._available and now - self._available[0] < _AVAILABILITY_TTL:
            return self._available[1]
        ok = False
        try:
            response = self._client.get("/api/tags", timeout=3.0)
            response.raise_for_status()
            names = {m.get("name") for m in response.json().get("models", [])}
            names |= {n.split(":")[0] + ":latest" for n in names if n and ":" not in n}
            ok = self.model in names or f"{self.model}:latest" in names
        except (httpx.HTTPError, ValueError):
            ok = False
        self._available = (now, ok)
        return ok

    def _chat(self, prompt: str, schema: dict, system: str | None = SYSTEM_PROMPT, max_tokens: int = 2048) -> dict:
        messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
        body = {
            "model": self.model,
            "messages": messages,
            "format": schema,
            "stream": False,
            "think": False,
            "options": {"temperature": 0, "num_ctx": 8192, "num_predict": max_tokens},
        }
        try:
            response = self._client.post("/api/chat", json=body)
            response.raise_for_status()
            payload = response.json()
            content = payload["message"]["content"]
            self._record_speed(payload)
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            raise ProviderError(f"ollama request failed: {exc}") from exc
        content = content.strip()
        if content.startswith("```"):
            content = content.strip("`")
            content = content[content.find("{"):]
        try:
            return json.loads(content)
        except json.JSONDecodeError as exc:
            raise ProviderError(f"ollama returned invalid JSON: {exc}") from exc

    def _record_speed(self, payload: dict) -> None:
        count, duration = payload.get("eval_count"), payload.get("eval_duration")
        if isinstance(count, int) and isinstance(duration, (int, float)) and count > 20 and duration > 0:
            observed = count / (duration / 1e9)
            self.tokens_per_second = 0.7 * self.tokens_per_second + 0.3 * observed

    def extract(self, text: str, doc_type: str) -> RawExtraction:
        numbered, lines = number_lines(trim_for_llm(text, self.settings.llm_max_chars))
        prompt = user_prompt(numbered, doc_type)
        last_error: Exception | None = None
        for attempt in range(2):  # one retry on invalid output
            try:
                return compact_to_raw(self._chat(prompt, EXTRACTION_SCHEMA), lines)
            except (ProviderError, ValidationError, AttributeError, TypeError) as exc:
                last_error = exc
                log.warning("ollama extraction attempt %d failed: %s", attempt + 1, exc)
                if isinstance(exc, ProviderError) and "request failed" in str(exc):
                    break  # network/timeouts: don't hammer a slow local model
        raise ProviderError(str(last_error))

    def classify(self, text: str) -> str:
        data = self._chat(CLASSIFY_PROMPT.format(text=trim_for_llm(text, 4000)), CLASSIFY_SCHEMA, system=None)
        doc_type = data.get("doc_type")
        if doc_type not in {"prescription", "lab_report", "discharge_summary", "other"}:
            raise ProviderError(f"unexpected doc_type {doc_type!r}")
        return doc_type
