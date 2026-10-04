"""Pydantic models.

Two families live here:

* **Contract models** (`*Data`, `ExtractedItem`, `ExtractResponse`, ...) — the public
  shapes defined in docs/CONTRACTS.md §1–§2. These are what the Go worker receives.
* **Raw models** (`Raw*`) — what an extractor (LLM or rules) produces: fields copied
  *as written* in the document. The normalizers in `app/normalize` turn raw → contract.
  Keeping the LLM's job this small (locate + transcribe) is a deliberate reliability
  choice: medical semantics such as "1-0-1 means twice daily" are decided by tested code,
  not by the model.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

DocType = Literal["prescription", "lab_report", "discharge_summary", "other"]
DOC_TYPES: tuple[str, ...] = ("prescription", "lab_report", "discharge_summary", "other")
ItemKind = Literal["lab_result", "medication", "diagnosis", "allergy", "encounter"]


def _blank_to_none(value):
    """Contract rule: unknown values are null, never empty strings."""
    if isinstance(value, str):
        value = value.strip()
        if not value or value.lower() in {"null", "none", "n/a", "na", "-", "--", "nil", "unknown"}:
            return None
    return value


class RawModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    @field_validator("*", mode="before")
    @classmethod
    def _clean(cls, value):
        return _blank_to_none(value)


# --------------------------------------------------------------------------- raw


class RawLab(RawModel):
    test_name_as_written: str | None = None
    value_as_written: str | None = None
    unit_as_written: str | None = None
    reference_range_as_written: str | None = None
    flag_as_written: str | None = None
    source_text: str | None = None
    # Extractor's own certainty in [0, 1]; set by the rules extractor, not asked from the LLM.
    extractor_confidence: float | None = None


class RawMedication(RawModel):
    name_as_written: str | None = None
    strength_as_written: str | None = None
    form_as_written: str | None = None
    schedule_as_written: str | None = None
    duration_as_written: str | None = None
    instructions: str | None = None
    source_text: str | None = None
    extractor_confidence: float | None = None


class RawDiagnosis(RawModel):
    name: str | None = None
    status_as_written: str | None = None
    source_text: str | None = None
    extractor_confidence: float | None = None


class RawAllergy(RawModel):
    substance: str | None = None
    reaction: str | None = None
    source_text: str | None = None
    extractor_confidence: float | None = None


class RawEncounter(RawModel):
    # visit | admission | discharge | follow_up
    type: str | None = None
    date_as_written: str | None = None
    # e.g. "after 2 weeks" when no absolute date is given
    relative_as_written: str | None = None
    facility: str | None = None
    doctor: str | None = None
    notes: str | None = None
    source_text: str | None = None
    extractor_confidence: float | None = None


class RawDocument(RawModel):
    date_as_written: str | None = None
    facility: str | None = None
    doctor: str | None = None
    patient_name: str | None = None


class RawExtraction(BaseModel):
    model_config = ConfigDict(extra="ignore")

    document: RawDocument = Field(default_factory=RawDocument)
    lab_results: list[RawLab] = Field(default_factory=list)
    medications: list[RawMedication] = Field(default_factory=list)
    diagnoses: list[RawDiagnosis] = Field(default_factory=list)
    allergies: list[RawAllergy] = Field(default_factory=list)
    encounters: list[RawEncounter] = Field(default_factory=list)

    @field_validator("lab_results", "medications", "diagnoses", "allergies", "encounters", mode="before")
    @classmethod
    def _null_list(cls, value):
        return value or []

    @field_validator("document", mode="before")
    @classmethod
    def _null_doc(cls, value):
        return value or {}


# ---------------------------------------------------------------------- contract


class LabResultData(BaseModel):
    test_name_original: str
    canonical_code: str | None
    canonical_name: str | None
    value: float | None
    value_text: str | None
    unit: str | None
    value_original: float | None
    unit_original: str | None
    reference_low: float | None
    reference_high: float | None
    flag: Literal["low", "normal", "high"] | None
    measured_at: str | None


class MedicationData(BaseModel):
    name_original: str
    generic_name: str
    brand_name: str | None
    canonical_key: str
    form: Literal["tablet", "capsule", "syrup", "injection", "drops", "ointment", "inhaler", "other"] | None
    dose_value: float | None
    dose_unit: str | None
    frequency_code: Literal["OD", "BD", "TDS", "QID", "HS", "SOS", "STAT", "WEEKLY"] | None
    times_per_day: int | None
    schedule: str | None
    timing: Literal["before_food", "after_food", "with_food", "bedtime"] | None
    duration_days: int | None
    instructions: str | None


class DiagnosisData(BaseModel):
    name: str
    status: Literal["active", "resolved", "suspected"] | None


class AllergyData(BaseModel):
    substance: str
    reaction: str | None


class EncounterData(BaseModel):
    type: Literal["visit", "admission", "discharge", "follow_up"]
    date: str | None
    facility: str | None
    doctor: str | None
    notes: str | None


class ExtractedItem(BaseModel):
    kind: ItemKind
    data: dict
    source_text: str | None
    confidence: float
    grounded: bool
    issues: list[str]


class DocumentMeta(BaseModel):
    date: str | None = None
    facility: str | None = None
    doctor: str | None = None
    patient_name: str | None = None


class ExtractRequest(BaseModel):
    text: str = Field(max_length=500_000)
    doc_type: DocType | Literal["unknown"] = "other"
    ocr_confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class ExtractResponse(BaseModel):
    doc_type: str
    provider: Literal["ollama", "anthropic", "rules"]
    model: str | None
    document: DocumentMeta
    items: list[ExtractedItem]


class ClassifyRequest(BaseModel):
    text: str = Field(max_length=500_000)


class ClassifyResponse(BaseModel):
    doc_type: DocType
    confidence: float
    method: Literal["rules", "llm"]
    scores: dict[str, float]


class OCRPage(BaseModel):
    page: int
    text: str
    method: Literal["text_layer", "tesseract"]
    confidence: float


class OCRResponse(BaseModel):
    text: str
    page_count: int
    method: Literal["text_layer", "tesseract", "mixed"]
    mean_confidence: float
    pages: list[OCRPage]


class LLMStatus(BaseModel):
    provider: str
    model: str | None
    available: bool


class HealthResponse(BaseModel):
    status: str
    llm: LLMStatus
