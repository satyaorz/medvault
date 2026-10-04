"""Anthropic (Claude) provider — optional, enabled when ANTHROPIC_API_KEY is set.

Uses the official SDK with structured outputs (`output_config.format`), so the reply is
guaranteed to be JSON matching EXTRACTION_SCHEMA. Extraction is transcription work, so
effort is kept low.
"""

from __future__ import annotations

import json
import logging

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


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, settings: Settings, client=None):
        self.settings = settings
        self.model = settings.anthropic_model
        self._client = client

    def _get_client(self):
        if self._client is None:
            import anthropic  # imported lazily: optional dependency at runtime

            self._client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key, max_retries=2, timeout=120.0)
        return self._client

    def available(self) -> bool:
        return bool(self.settings.anthropic_api_key)

    def estimate_seconds(self, expected_output_tokens: int) -> float:
        return 5.0 + expected_output_tokens / 80.0

    def _structured(self, prompt: str, schema: dict, system: str | None, max_tokens: int) -> dict:
        import anthropic

        kwargs = {
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
            "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        }
        if system:
            kwargs["system"] = system
        try:
            response = self._get_client().messages.create(**kwargs)
        except anthropic.RateLimitError as exc:
            raise ProviderError(f"anthropic rate limited: {exc}") from exc
        except anthropic.APIStatusError as exc:
            raise ProviderError(f"anthropic API error {exc.status_code}: {exc.message}") from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderError(f"anthropic connection error: {exc}") from exc
        if response.stop_reason == "refusal":
            raise ProviderError("anthropic declined the request")
        if response.stop_reason == "max_tokens":
            raise ProviderError("anthropic output truncated (max_tokens)")
        text = next((block.text for block in response.content if block.type == "text"), None)
        if text is None:
            raise ProviderError("anthropic returned no text block")
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise ProviderError(f"anthropic returned invalid JSON: {exc}") from exc

    def extract(self, text: str, doc_type: str) -> RawExtraction:
        numbered, lines = number_lines(trim_for_llm(text, self.settings.llm_max_chars * 4))
        data = self._structured(user_prompt(numbered, doc_type), EXTRACTION_SCHEMA, SYSTEM_PROMPT, max_tokens=16000)
        try:
            return compact_to_raw(data, lines)
        except (ValidationError, AttributeError, TypeError) as exc:
            raise ProviderError(f"anthropic output failed validation: {exc}") from exc

    def classify(self, text: str) -> str:
        data = self._structured(CLASSIFY_PROMPT.format(text=trim_for_llm(text, 6000)), CLASSIFY_SCHEMA, None, 1024)
        return data["doc_type"]
