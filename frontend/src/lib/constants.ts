import type {
  DiagnosisStatus,
  DocStatus,
  DocType,
  EncounterType,
  FrequencyCode,
  ItemKind,
  MedicationForm,
  MedicationStatus,
  MedicationTiming,
  ProcessingStage,
  Relationship,
  Sex,
} from "@/lib/types"

export const DOC_TYPES: DocType[] = ["prescription", "lab_report", "discharge_summary", "other", "unknown"]
/** Types a user may pick explicitly (`unknown` is only an internal state). */
export const SELECTABLE_DOC_TYPES: Exclude<DocType, "unknown">[] = [
  "prescription",
  "lab_report",
  "discharge_summary",
  "other",
]

export const DOC_TYPE_LABELS: Record<DocType | "follow_up", string> = {
  prescription: "Prescription",
  lab_report: "Lab report",
  discharge_summary: "Discharge summary",
  other: "Other",
  unknown: "Unclassified",
  follow_up: "Follow-up",
}

export const DOC_STATUSES: DocStatus[] = ["queued", "processing", "needs_review", "completed", "failed"]

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  needs_review: "Needs review",
  completed: "Completed",
  failed: "Failed",
}

/** Pipeline stages in order (excluding the terminal `failed`). */
export const PIPELINE_STAGES: Exclude<ProcessingStage, "failed">[] = [
  "queued",
  "ocr",
  "classifying",
  "extracting",
  "validating",
  "done",
]

export const STAGE_LABELS: Record<ProcessingStage, string> = {
  queued: "Queued",
  ocr: "Reading text (OCR)",
  classifying: "Identifying document type",
  extracting: "Extracting medical data",
  validating: "Validating & saving",
  done: "Done",
  failed: "Failed",
}

export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  lab_result: "Lab result",
  medication: "Medication",
  diagnosis: "Diagnosis",
  allergy: "Allergy",
  encounter: "Encounter",
}

export const ITEM_KIND_PLURALS: Record<ItemKind, string> = {
  lab_result: "Lab results",
  medication: "Medications",
  diagnosis: "Diagnoses",
  allergy: "Allergies",
  encounter: "Visits & follow-ups",
}

export const ITEM_KIND_ORDER: ItemKind[] = ["lab_result", "medication", "diagnosis", "allergy", "encounter"]

export const FREQUENCY_CODES: FrequencyCode[] = ["OD", "BD", "TDS", "QID", "HS", "SOS", "STAT", "WEEKLY"]

export const FREQUENCY_LABELS: Record<FrequencyCode, string> = {
  OD: "Once a day",
  BD: "Twice a day",
  TDS: "Three times a day",
  QID: "Four times a day",
  HS: "At bedtime",
  SOS: "When needed",
  STAT: "Immediately, once",
  WEEKLY: "Once a week",
}

export const TIMINGS: MedicationTiming[] = ["before_food", "after_food", "with_food", "bedtime"]

export const TIMING_LABELS: Record<MedicationTiming, string> = {
  before_food: "Before food",
  after_food: "After food",
  with_food: "With food",
  bedtime: "At bedtime",
}

export const MEDICATION_FORMS: MedicationForm[] = [
  "tablet",
  "capsule",
  "syrup",
  "injection",
  "drops",
  "ointment",
  "inhaler",
  "other",
]

export const FORM_LABELS: Record<MedicationForm, string> = {
  tablet: "Tablet",
  capsule: "Capsule",
  syrup: "Syrup",
  injection: "Injection",
  drops: "Drops",
  ointment: "Ointment",
  inhaler: "Inhaler",
  other: "Other",
}

export const MEDICATION_STATUS_LABELS: Record<MedicationStatus, string> = {
  active: "Active",
  course_completed: "Course completed",
  not_in_latest: "Not in latest prescription",
}

export const DIAGNOSIS_STATUSES: DiagnosisStatus[] = ["active", "resolved", "suspected"]
export const DIAGNOSIS_STATUS_LABELS: Record<DiagnosisStatus, string> = {
  active: "Active",
  resolved: "Resolved",
  suspected: "Suspected",
}

export const ENCOUNTER_TYPES: EncounterType[] = ["visit", "admission", "discharge", "follow_up"]
export const ENCOUNTER_TYPE_LABELS: Record<EncounterType, string> = {
  visit: "Doctor visit",
  admission: "Admission",
  discharge: "Discharge",
  follow_up: "Follow-up",
}

export const RELATIONSHIPS: Relationship[] = ["self", "parent", "child", "spouse", "sibling", "grandparent", "other"]
export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  self: "Me",
  parent: "Parent",
  child: "Child",
  spouse: "Spouse",
  sibling: "Sibling",
  grandparent: "Grandparent",
  other: "Other",
}

export const SEXES: Sex[] = ["female", "male", "other"]
export const SEX_LABELS: Record<Sex, string> = { female: "Female", male: "Male", other: "Other" }

/** Matches the worker's auto-accept threshold (CONTRACTS.md §3 ExtractedItem). */
export const AUTO_ACCEPT_CONFIDENCE = 0.85

export const POLL_INTERVAL_MS = 2000
