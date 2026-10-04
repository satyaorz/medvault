"""LLM providers are tested with mocked transports — no network, no model downloads."""

import json

import httpx
import pytest

from app.config import Settings
from app.extract import pipeline
from app.extract.anthropic_provider import AnthropicProvider
from app.extract.base import ProviderError
from app.extract.ollama import OllamaProvider
from tests.conftest import LAB_REPORT, PRESCRIPTION


def _settings(**overrides) -> Settings:
    base = Settings.from_env()
    values = {**base.__dict__, **overrides}
    return Settings(**values)


def _ollama_reply(content) -> httpx.Response:
    text = content if isinstance(content, str) else json.dumps(content)
    return httpx.Response(200, json={"message": {"role": "assistant", "content": text}})


# compact schema: the model cites line numbers ("ln") of the numbered OCR text
LLM_PRESCRIPTION = {
    "doc": {"date": "15/08/2026", "facility": "Heart & Diabetes Care Centre", "doctor": "Dr. Arjun Sharma",
            "patient": "Arjun Mehta"},
    "labs": [],
    "meds": [
        "8|TAB. Amlong 10|1-0-0|x 30 days|after food",
        # hallucinated: not in the document, and line 9 doesn't mention it
        "9|TAB. Ecosprin 75|OD||",
    ],
    "diagnoses": ["5|Essential Hypertension|"],
    "allergies": [],
    "encounters": ["14|follow_up|15/11/2026|"],
}


class Recorder:
    def __init__(self, replies):
        self.replies = list(replies)
        self.requests = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "llama3.1:8b"}]})
        reply = self.replies.pop(0)
        return reply(request) if callable(reply) else reply


def _ollama(recorder) -> OllamaProvider:
    return OllamaProvider(_settings(ollama_model="llama3.1:8b"), transport=httpx.MockTransport(recorder))


def test_ollama_sends_schema_and_parses_output():
    rec = Recorder([_ollama_reply(LLM_PRESCRIPTION)])
    provider = _ollama(rec)
    assert provider.available()
    raw = provider.extract(PRESCRIPTION, "prescription")
    assert raw.medications[0].name_as_written == "TAB. Amlong 10"
    # the line citation is resolved to the verbatim OCR line
    assert raw.medications[0].source_text == "1. TAB. Amlong 10   1-0-0  x 30 days  (after food)"
    assert raw.encounters[0].source_text == "Review on 15/11/2026 with HbA1c"
    body = json.loads(rec.requests[-1].content)
    assert "8| 1. TAB. Amlong 10" in body["messages"][-1]["content"]
    assert body["format"]["type"] == "object" and body["stream"] is False
    assert body["options"]["temperature"] == 0 and body["think"] is False


def test_ollama_retries_once_on_invalid_json():
    rec = Recorder([_ollama_reply("not json {"), _ollama_reply(LLM_PRESCRIPTION)])
    raw = _ollama(rec).extract(PRESCRIPTION, "prescription")
    assert len(raw.medications) == 2
    assert sum(1 for r in rec.requests if r.url.path == "/api/chat") == 2


def test_ollama_gives_up_after_two_invalid_outputs():
    rec = Recorder([_ollama_reply("nope"), _ollama_reply({"meds": "not-a-list"})])
    with pytest.raises(ProviderError):
        _ollama(rec).extract(PRESCRIPTION, "prescription")


def test_ollama_unavailable_when_model_missing():
    def handler(request):
        return httpx.Response(200, json={"models": [{"name": "qwen3.5:9b"}]})

    provider = OllamaProvider(_settings(ollama_model="llama3.1:8b"), transport=httpx.MockTransport(handler))
    assert not provider.available()


def test_pipeline_uses_llm_output_with_grounding_and_agreement(monkeypatch):
    rec = Recorder([_ollama_reply(LLM_PRESCRIPTION)])
    provider = _ollama(rec)
    monkeypatch.setattr(pipeline, "select_provider", lambda settings=None, requested=None: provider)
    response = pipeline.extract(PRESCRIPTION, "prescription")
    assert response.provider == "ollama" and response.model == "llama3.1:8b"
    meds = {item.data["canonical_key"]: item for item in response.items if item.kind == "medication"}
    amlodipine = meds["amlodipine"]
    assert amlodipine.grounded and amlodipine.confidence >= 0.95     # LLM + rules agree
    aspirin = meds["aspirin"]
    assert not aspirin.grounded and aspirin.confidence <= 0.4        # hallucination is caught
    assert "source text not found in the document" in aspirin.issues
    assert response.document.date == "2026-08-15"


def test_pipeline_falls_back_to_rules_when_llm_fails(monkeypatch):
    def boom(request):
        raise httpx.ConnectError("connection refused")

    rec = Recorder([boom])
    provider = _ollama(rec)
    monkeypatch.setattr(pipeline, "select_provider", lambda settings=None, requested=None: provider)
    response = pipeline.extract(LAB_REPORT, "lab_report")
    assert response.provider == "rules"
    assert len([i for i in response.items if i.kind == "lab_result"]) == 6


def test_select_provider_rules_and_auto(monkeypatch):
    assert pipeline.select_provider(_settings(llm_provider="rules")) is None
    # auto with no key and an unreachable Ollama → rules
    monkeypatch.setattr(OllamaProvider, "available", lambda self: False)
    assert pipeline.select_provider(_settings(llm_provider="auto", ollama_url="http://127.0.0.1:9")) is None


def test_select_provider_prefers_anthropic_when_key_set():
    provider = pipeline.select_provider(_settings(llm_provider="auto", anthropic_api_key="sk-test"))
    assert provider.name == "anthropic"


class _FakeBlock:
    type = "text"

    def __init__(self, text):
        self.text = text


class _FakeMessages:
    def __init__(self, payload, stop_reason="end_turn"):
        self.payload, self.stop_reason, self.calls = payload, stop_reason, []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return type("Msg", (), {"stop_reason": self.stop_reason, "content": [_FakeBlock(json.dumps(self.payload))]})()


def test_anthropic_provider_uses_structured_outputs():
    messages = _FakeMessages(LLM_PRESCRIPTION)
    client = type("Client", (), {"messages": messages})()
    provider = AnthropicProvider(_settings(anthropic_api_key="sk-test"), client=client)
    raw = provider.extract(PRESCRIPTION, "prescription")
    assert raw.medications[0].name_as_written == "TAB. Amlong 10"
    assert raw.medications[1].source_text == "TAB. Ecosprin 75 OD"   # citation failed → synthesized snippet
    call = messages.calls[0]
    assert call["output_config"]["format"]["type"] == "json_schema"
    assert call["model"] == provider.model


def test_anthropic_refusal_raises_provider_error():
    client = type("Client", (), {"messages": _FakeMessages({}, stop_reason="refusal")})()
    with pytest.raises(ProviderError):
        AnthropicProvider(_settings(anthropic_api_key="sk-test"), client=client).extract("x", "other")


def test_compact_rows_are_parsed_and_shifted_lab_rows_repaired():
    from app.extract.prompts import compact_to_raw, number_lines

    _, lines = number_lines("CITYCARE\nCOMPLETE BLOOD COUNT (CBC)\nHemoglobin  10.7  gm%  13.0 - 17.0")
    data = {"doc": {"date": None, "facility": None, "doctor": None, "patient": None},
            "labs": ["3|Hemoglobin|10.7|gm%|13.0 - 17.0|",
                     "3|COMPLETE BLOOD COUNT (CBC)|Hemoglobin: 10.7 gm% (13.0 - 17.0)",   # shifted fields
                     "2|COMPLETE BLOOD COUNT (CBC)|"],                                     # header, no value
            "meds": [], "diagnoses": [], "allergies": ["1|NKDA|"], "encounters": []}
    raw = compact_to_raw(data, lines)
    assert [(lab.test_name_as_written, lab.value_as_written, lab.unit_as_written) for lab in raw.lab_results] == [
        ("Hemoglobin", "10.7", "gm%"), ("Hemoglobin", "10.7", "gm%")]
    assert raw.lab_results[0].source_text == "Hemoglobin  10.7  gm%  13.0 - 17.0"


def test_budget_routing_skips_slow_local_llm(monkeypatch):
    rec = Recorder([])
    provider = _ollama(rec)
    provider.tokens_per_second = 1.0       # pretend the model is very slow
    monkeypatch.setenv("LLM_BUDGET_SECONDS", "60")
    monkeypatch.setattr(pipeline, "select_provider", lambda settings=None, requested=None: provider)
    response = pipeline.extract(LAB_REPORT, "lab_report")
    assert response.provider == "rules"
    assert not any(r.url.path == "/api/chat" for r in rec.requests)   # no LLM call was made


def test_nkda_is_never_an_allergy(monkeypatch):
    payload = {**LLM_PRESCRIPTION, "allergies": ["6|NKDA|", "6|Penicillin|rash"]}
    provider = _ollama(Recorder([_ollama_reply(payload)]))
    monkeypatch.setattr(pipeline, "select_provider", lambda settings=None, requested=None: provider)
    response = pipeline.extract(PRESCRIPTION, "prescription")
    assert [i.data["substance"] for i in response.items if i.kind == "allergy"] == ["Penicillin"]


def test_ensemble_keeps_rules_only_facts_and_flags_disagreements(monkeypatch):
    payload = {**LLM_PRESCRIPTION,
               "meds": ["8|TAB. Amlong 5|1-0-0|x 30 days|"]}   # LLM misread 10 mg as 5 mg
    provider = _ollama(Recorder([_ollama_reply(payload)]))
    monkeypatch.setattr(pipeline, "select_provider", lambda settings=None, requested=None: provider)
    response = pipeline.extract(PRESCRIPTION, "prescription")
    meds = [i for i in response.items if i.kind == "medication"]
    amlodipine = [m for m in meds if m.data["canonical_key"] == "amlodipine"]
    assert len(amlodipine) == 1 and amlodipine[0].data["dose_value"] == 5
    assert amlodipine[0].confidence <= 0.7
    assert any("different value (10.0 mg OD)" in issue for issue in amlodipine[0].issues)
    # medicines the LLM missed but the rules found are still reported
    assert {"rosuvastatin", "metformin", "paracetamol", "telmisartan"} <= {m.data["canonical_key"] for m in meds}
