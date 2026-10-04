/**
 * TypeScript mirror of docs/CONTRACTS.md (§1 shared vocabulary, §3 public REST API).
 * Keep this file in lock-step with the contract — change the contract first.
 */

// ── §1 Shared vocabulary ─────────────────────────────────────────────────────

export type DocType = "prescription" | "lab_report" | "discharge_summary" | "other" | "unknown"
export type DocStatus = "queued" | "processing" | "needs_review" | "completed" | "failed"
export type ProcessingStage = "queued" | "ocr" | "classifying" | "extracting" | "validating" | "done" | "failed"
export type StepStatus = "running" | "completed" | "failed" | "skipped"
export type OcrMethod = "text_layer" | "tesseract" | "mixed"

export type ItemKind = "lab_result" | "medication" | "diagnosis" | "allergy" | "encounter"
export type ItemStatus = "needs_review" | "accepted" | "rejected"
export type LabFlag = "low" | "normal" | "high"

export type MedicationForm =
  | "tablet"
  | "capsule"
  | "syrup"
  | "injection"
  | "drops"
  | "ointment"
  | "inhaler"
  | "other"
export type FrequencyCode = "OD" | "BD" | "TDS" | "QID" | "HS" | "SOS" | "STAT" | "WEEKLY"
export type MedicationTiming = "before_food" | "after_food" | "with_food" | "bedtime"
export type DiagnosisStatus = "active" | "resolved" | "suspected"
export type EncounterType = "visit" | "admission" | "discharge" | "follow_up"

/** ISO calendar date, `YYYY-MM-DD`. */
export type ISODate = string
/** RFC 3339 timestamp. */
export type Timestamp = string

export interface LabResultData {
  test_name_original: string
  canonical_code: string | null
  canonical_name: string | null
  value: number | null
  value_text: string | null
  unit: string | null
  value_original: number | string | null
  unit_original: string | null
  reference_low: number | null
  reference_high: number | null
  flag: LabFlag | null
  measured_at: ISODate | null
}

export interface MedicationData {
  name_original: string
  generic_name: string
  brand_name: string | null
  canonical_key: string
  form: MedicationForm | null
  dose_value: number | null
  dose_unit: string | null
  frequency_code: FrequencyCode | null
  times_per_day: number | null
  schedule: string | null
  timing: MedicationTiming | null
  duration_days: number | null
  instructions: string | null
}

export interface DiagnosisData {
  name: string
  status: DiagnosisStatus | null
}

export interface AllergyData {
  substance: string
  reaction: string | null
}

export interface EncounterData {
  type: EncounterType
  date: ISODate | null
  facility: string | null
  doctor: string | null
  notes: string | null
}

export interface ItemDataByKind {
  lab_result: LabResultData
  medication: MedicationData
  diagnosis: DiagnosisData
  allergy: AllergyData
  encounter: EncounterData
}

// ── §3 Objects ───────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  name: string
  created_at: Timestamp
}

export type Relationship = "self" | "parent" | "child" | "spouse" | "sibling" | "grandparent" | "other"
export type Sex = "male" | "female" | "other"

export interface Profile {
  id: string
  name: string
  relationship: Relationship
  date_of_birth: ISODate | null
  sex: Sex | null
  created_at: Timestamp
  document_count: number
}

export interface ProfileInput {
  name: string
  relationship: Relationship
  date_of_birth?: ISODate | null
  sex?: Sex | null
}

export interface MedDocument {
  id: string
  profile_id: string
  filename: string
  content_type: string
  size_bytes: number
  title: string | null
  doc_type: DocType
  doc_type_source: "ai" | "user"
  doc_date: ISODate | null
  source: string | null
  status: DocStatus
  stage: ProcessingStage
  error: string | null
  classification_confidence: number | null
  ocr_method: OcrMethod | null
  ocr_confidence: number | null
  page_count: number | null
  pending_items: number
  item_count: number
  created_at: Timestamp
  updated_at: Timestamp
}

export interface ProcessingStep {
  stage: ProcessingStage
  status: StepStatus
  message: string | null
  started_at: Timestamp | null
  finished_at: Timestamp | null
}

export interface DocumentDetail extends MedDocument {
  ocr_text: string | null
  steps: ProcessingStep[]
}

export interface DocumentPatch {
  title?: string | null
  doc_date?: ISODate | null
  doc_type?: DocType
  source?: string | null
}

export interface DocumentListQuery {
  q?: string
  type?: DocType
  status?: DocStatus
  from?: ISODate
  to?: ISODate
  limit?: number
  offset?: number
}

interface ExtractedItemBase {
  id: string
  document_id: string
  profile_id: string
  source_text: string | null
  confidence: number
  grounded: boolean
  issues: string[]
  status: ItemStatus
  reviewed_by: "auto" | "user" | null
  created_at: Timestamp
  reviewed_at: Timestamp | null
}

/** Discriminated union: narrowing on `kind` types `data`. */
export type ExtractedItem = {
  [K in ItemKind]: ExtractedItemBase & { kind: K; data: ItemDataByKind[K] }
}[ItemKind]

export interface ReviewDocumentRef {
  id: string
  filename: string
  title: string | null
  doc_type: DocType
  doc_date: ISODate | null
}

export type ReviewItem = ExtractedItem & { document: ReviewDocumentRef }

export interface ItemReviewInput {
  action: "accept" | "reject"
  data?: ItemDataByKind[ItemKind]
}

export interface LabPoint {
  id: string
  value: number | null
  value_text: string | null
  unit: string | null
  reference_low: number | null
  reference_high: number | null
  flag: LabFlag | null
  measured_at: ISODate
  document_id: string
  test_name_original: string
  value_original: number | string | null
  unit_original: string | null
}

export type Trend = "up" | "down" | "flat"

export interface LabTestSummary {
  code: string
  name: string
  unit: string | null
  count: number
  latest: LabPoint
  previous: LabPoint | null
  trend: Trend | null
}

export interface LabSeries {
  test: { code: string; name: string; unit: string | null }
  results: LabPoint[]
}

export interface RecentLab {
  code: string
  name: string
  unit: string | null
  latest: LabPoint
  previous: LabPoint | null
}

export interface UpcomingEncounter {
  type: EncounterType
  date: ISODate
  doctor: string | null
  facility: string | null
  notes: string | null
  document_id: string
}

export interface ProfileSummary {
  profile: Profile
  counts: {
    documents: number
    processing: number
    pending_review: number
    active_medications: number
    lab_tests: number
  }
  recent_documents: MedDocument[]
  recent_labs: RecentLab[]
  upcoming: UpcomingEncounter[]
}

export interface TimelineHighlight {
  kind: ItemKind
  label: string
  value: string
  flag?: LabFlag | null
}

export interface TimelineEvent {
  id: string
  date: ISODate
  type: DocType | "follow_up"
  title: string
  subtitle: string | null
  document_id: string | null
  status: DocStatus | null
  highlights: TimelineHighlight[]
}

export type MedicationStatus = "active" | "course_completed" | "not_in_latest"

export interface MedicationEvent {
  id: string
  document_id: string
  prescribed_at: ISODate | null
  brand_name: string | null
  name_original: string | null
  form: MedicationForm | null
  dose_value: number | null
  dose_unit: string | null
  frequency_code: FrequencyCode | null
  times_per_day: number | null
  schedule: string | null
  timing: MedicationTiming | null
  duration_days: number | null
  instructions: string | null
}

export interface Medication {
  id: string
  canonical_key: string
  generic_name: string
  status: MedicationStatus
  latest: MedicationEvent
  history: MedicationEvent[]
}

export interface HealthStatus {
  status: string
  db: string
  redis: string
  storage: string
  ai: string
}

// ── Errors ───────────────────────────────────────────────────────────────────

export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  | "unsupported_media_type"
  | "validation_failed"
  | "rate_limited"
  | "internal"
  | "network_error"

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode
    message: string
    fields?: Record<string, string>
    existing_id?: string
  }
}
