# MedVault — Service Contracts (Phase 1 + 2)

This file is the single source of truth for how the three services talk to each other.
Change it first, then change the code.

```
 Browser ──► Next.js (frontend, :3000)  ── rewrites /api/* ──►  Go API (:8080)
                                                                   │  │
                                                    PostgreSQL ◄───┘  ├──► S3 / SeaweedFS (original files)
                                                                      └──► Redis (Asynq job queue)
                                                                               │
                                                     Go worker (asynq) ◄───────┘
                                                        │
                                                        └──HTTP──► Python AI service (:8000)
                                                                     OCR · classify · extract+normalize
                                                                     (LLM: Ollama / Anthropic / rules)
```

Key rule: **the AI service is stateless and never touches the database.** The Go worker
validates everything the AI returns and is the only writer of structured medical data.

---

## 1. Shared vocabulary

### Document types (`doc_type`)
`prescription` · `lab_report` · `discharge_summary` · `other` · `unknown` (not yet classified)

### Document status (`status`)
| status | meaning |
|---|---|
| `queued` | uploaded, job enqueued |
| `processing` | worker is running (see `stage`) |
| `needs_review` | finished, but ≥1 extracted item awaits user confirmation |
| `completed` | finished, nothing pending |
| `failed` | gave up after retries (`error` is set) |

### Processing stages (`stage`)
`queued` → `ocr` → `classifying` → `extracting` → `validating` → `done` (or `failed`)

### Extracted item kinds (`kind`) and their `data` payloads

All payloads are **already normalized** by the AI service. Unknown values are `null`, never `""`.
Dates are `YYYY-MM-DD` strings.

**`lab_result`**
```json
{
  "test_name_original": "HGB",
  "canonical_code": "hemoglobin",          // null if unrecognized
  "canonical_name": "Hemoglobin",          // null if unrecognized
  "value": 13.2,                            // number in canonical unit, null if non-numeric
  "value_text": null,                       // e.g. "Positive", "Reactive" when value is null
  "unit": "g/dL",                           // canonical unit (or original if unrecognized)
  "value_original": 132,                    // as printed
  "unit_original": "g/L",                   // as printed (may be null)
  "reference_low": 13.0,                    // in canonical unit, nullable
  "reference_high": 17.0,                   // in canonical unit, nullable
  "flag": "normal",                         // "low" | "normal" | "high" | null
  "measured_at": "2026-01-12"               // nullable → worker falls back to document date
}
```

**`medication`**
```json
{
  "name_original": "TAB. Pan 40",
  "generic_name": "Pantoprazole",           // normalized generic (title case)
  "brand_name": "Pan",                      // nullable
  "canonical_key": "pantoprazole",          // lowercase generic, combo joined with "+": "amoxicillin+clavulanate"
  "form": "tablet",                         // tablet|capsule|syrup|injection|drops|ointment|inhaler|other|null
  "dose_value": 40,                         // nullable
  "dose_unit": "mg",                        // nullable
  "frequency_code": "OD",                   // OD|BD|TDS|QID|HS|SOS|STAT|WEEKLY|null
  "times_per_day": 1,                       // nullable
  "schedule": "1-0-0",                      // morning-afternoon-night, nullable
  "timing": "before_food",                  // before_food|after_food|with_food|bedtime|null
  "duration_days": 7,                       // nullable
  "instructions": "Before breakfast"        // nullable free text
}
```

**`diagnosis`**
```json
{ "name": "Type 2 diabetes mellitus", "status": "active" }   // status: active|resolved|suspected|null
```

**`allergy`**
```json
{ "substance": "Penicillin", "reaction": "Rash" }             // reaction nullable
```

**`encounter`**
```json
{
  "type": "visit",                          // visit|admission|discharge|follow_up
  "date": "2026-03-03",                     // nullable
  "facility": "City Hospital",              // nullable
  "doctor": "Dr. A. Sharma",                // nullable
  "notes": "Review after 3 months"          // nullable
}
```

---

## 2. AI service API (internal, Python FastAPI, default `http://localhost:8000`)

### `GET /health`
```json
{ "status": "ok", "llm": { "provider": "ollama", "model": "qwen3.5:9b", "available": true } }
```

### `POST /ocr` — multipart form, field `file` (PDF, PNG, JPEG, WEBP)
For each PDF page: use the embedded text layer if it has ≥ 40 meaningful characters, otherwise
rasterize at 300 DPI and run Tesseract. Images always go through Tesseract.
```json
{
  "text": "full text, pages joined with \n\n",
  "page_count": 2,
  "method": "text_layer",                   // "text_layer" | "tesseract" | "mixed"
  "mean_confidence": 0.93,                  // 0..1 ; 1.0 for text_layer pages
  "pages": [ { "page": 1, "text": "...", "method": "text_layer", "confidence": 1.0 } ]
}
```
Errors: `415` unsupported type, `422` unreadable/corrupt file.

### `POST /classify` — JSON `{ "text": "..." }`
Rule-based keyword scoring first; if the top-two margin is small and an LLM is available,
ask the LLM. Response:
```json
{ "doc_type": "lab_report", "confidence": 0.91, "method": "rules", "scores": { "lab_report": 0.91, "prescription": 0.05, "discharge_summary": 0.04, "other": 0.0 } }
```

### `POST /extract` — JSON `{ "text": "...", "doc_type": "lab_report" }`
Pipeline inside: LLM (or rules) → Pydantic schema validation → normalization (lab names,
units, medicine brands→generics, frequency shorthand) → grounding check (does
`source_text` really occur in the OCR text, fuzzy) → confidence scoring.
```json
{
  "doc_type": "lab_report",
  "provider": "ollama",                     // "ollama" | "anthropic" | "rules"
  "model": "qwen3.5:9b",                    // null for rules
  "document": {
    "date": "2026-01-12",                   // main date of the document, nullable
    "facility": "Apollo Diagnostics",       // nullable
    "doctor": "Dr. R. Mehta",               // nullable
    "patient_name": "Satya P."              // nullable
  },
  "items": [
    {
      "kind": "lab_result",
      "data": { ...payload for kind (see §1)... },
      "source_text": "HGB 132 g/L 130-170",  // verbatim snippet from OCR text
      "confidence": 0.94,                     // 0..1, final combined score
      "grounded": true,                       // source_text found in OCR text
      "issues": []                            // human-readable warnings, e.g. "unrecognized test name"
    }
  ]
}
```
Errors: `422` invalid request, `502` LLM failure after retries (the service should instead
fall back to the rules extractor and say `"provider": "rules"` whenever possible).

---

## 3. Public REST API (Go, default `http://localhost:8080`, all under `/api`)

Conventions
- JSON everywhere except uploads (multipart) and file download.
- Auth: httpOnly cookie `mv_session` (JWT HS256, 7-day expiry) set by register/login.
  `Authorization: Bearer <jwt>` is also accepted (scripts/tests).
- Errors: `{ "error": { "code": "not_found", "message": "document not found" } }`
  codes: `bad_request` 400, `unauthorized` 401, `forbidden` 403, `not_found` 404,
  `conflict` 409, `payload_too_large` 413, `unsupported_media_type` 415,
  `validation_failed` 422 (with `"fields": {"email": "invalid email"}`), `rate_limited` 429, `internal` 500.
- Resources owned by another user return **404** (no existence leak).
- IDs are UUID strings. Timestamps are RFC 3339. Dates are `YYYY-MM-DD`.

### Objects

**User** `{ "id", "email", "name", "created_at" }`

**Profile** `{ "id", "name", "relationship", "date_of_birth": "1990-05-01"|null, "sex": "male"|"female"|"other"|null, "created_at", "document_count": 3 }`
relationship: `self|parent|child|spouse|sibling|grandparent|other`

**Document**
```json
{
  "id": "…", "profile_id": "…",
  "filename": "blood_test_june.pdf", "content_type": "application/pdf", "size_bytes": 182734,
  "title": "Blood test" , "doc_type": "lab_report", "doc_type_source": "ai",   // "ai" | "user"
  "doc_date": "2026-06-02", "source": "Apollo Diagnostics",
  "status": "needs_review", "stage": "done", "error": null,
  "classification_confidence": 0.91, "ocr_method": "text_layer", "ocr_confidence": 0.98, "page_count": 1,
  "pending_items": 2, "item_count": 14,
  "created_at": "…", "updated_at": "…"
}
```
`GET /api/documents/{id}` additionally includes `"ocr_text"` and `"steps"`:
```json
"steps": [ { "stage": "ocr", "status": "completed", "message": "2 pages via text_layer", "started_at": "…", "finished_at": "…" } ]
```
step status: `running|completed|failed|skipped`

**ExtractedItem**
```json
{
  "id": "…", "document_id": "…", "profile_id": "…",
  "kind": "lab_result", "data": { … }, "source_text": "…",
  "confidence": 0.62, "grounded": true, "issues": ["unrecognized test name"],
  "status": "needs_review",                 // needs_review | accepted | rejected
  "reviewed_by": null,                      // "auto" | "user" | null
  "created_at": "…", "reviewed_at": null
}
```
Auto-accept rule (worker): `confidence >= 0.85 && grounded && issues is empty` → `accepted` / `reviewed_by: "auto"`;
otherwise `needs_review`. Only **accepted** items are materialized into labs / medications /
conditions / allergies / encounters, and only those appear in timeline, labs, medications.

### Auth
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/auth/register` | `{email, password (≥8), name}` | 201 `{user}` + cookie. Also creates a `self` profile named after the user |
| POST | `/api/auth/login` | `{email, password}` | 200 `{user}` + cookie (rate-limited: 10/min/IP) |
| POST | `/api/auth/logout` | – | 204, clears cookie |
| GET | `/api/auth/me` | – | 200 `{user}` |

### Profiles
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/profiles` | – | `{profiles: [Profile]}` (self first, then by created_at) |
| POST | `/api/profiles` | `{name, relationship, date_of_birth?, sex?}` | 201 `{profile}` |
| GET | `/api/profiles/{pid}` | – | `{profile}` |
| PATCH | `/api/profiles/{pid}` | any of the create fields | `{profile}` |
| DELETE | `/api/profiles/{pid}` | – | 204 (deletes documents + files). Cannot delete the last profile → 409 |
| GET | `/api/profiles/{pid}/summary` | – | see below |

Summary:
```json
{
  "profile": {Profile},
  "counts": { "documents": 24, "processing": 1, "pending_review": 3, "active_medications": 4, "lab_tests": 8 },
  "recent_documents": [Document ×5],
  "recent_labs": [ { "code": "hba1c", "name": "HbA1c", "unit": "%", "latest": {LabPoint}, "previous": {LabPoint}|null } ×≤6 ],
  "upcoming": [ { "type": "follow_up", "date": "2026-09-14", "doctor": "…", "facility": "…", "notes": "…", "document_id": "…" } ]
}
```

### Documents
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/profiles/{pid}/documents` | multipart: `file` (required, ≤20 MB, pdf/png/jpeg/webp sniffed from content), optional `title`, `doc_date`, `doc_type`, `source` | 202 `{document}` |
| GET | `/api/profiles/{pid}/documents` | query: `q` (full-text over title/filename/ocr text), `type`, `status`, `from`, `to` (doc_date), `limit` (≤100, default 50), `offset` | `{documents: [Document], total}` ordered by `doc_date desc nulls last, created_at desc` |
| GET | `/api/documents/{id}` | – | `{document}` (with `ocr_text`, `steps`) |
| GET | `/api/documents/{id}/file` | – | original bytes, `Content-Disposition: inline` |
| PATCH | `/api/documents/{id}` | `{title?, doc_date?, doc_type?, source?}` (setting doc_type marks `doc_type_source: "user"`) | `{document}` |
| DELETE | `/api/documents/{id}` | – | 204 |
| POST | `/api/documents/{id}/reprocess` | – | 202 `{document}` (drops previous extracted items) |
| GET | `/api/documents/{id}/items` | – | `{items: [ExtractedItem]}` |

Duplicate upload (same sha256 in same profile) → 409 `conflict` with `"existing_id"` in the error object.

### Review (human-in-the-loop)
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/profiles/{pid}/review` | – | `{items: [ExtractedItem & {document: {id, filename, title, doc_type, doc_date}}]}` oldest first |
| PATCH | `/api/items/{id}` | `{action: "accept"|"reject", data?: {corrected payload}}` | `{item}` — corrected `data` is re-validated (422 on failure); accepting materializes it; document status is recomputed |

### Timeline
`GET /api/profiles/{pid}/timeline` → events newest first. One event per processed document
plus one per encounter of type `follow_up` with a future date.
```json
{
  "events": [
    {
      "id": "doc:…", "date": "2026-09-02", "type": "lab_report",       // doc_type or "follow_up"
      "title": "Blood test", "subtitle": "Apollo Diagnostics",
      "document_id": "…", "status": "completed",
      "highlights": [                                                    // accepted items summary
        { "kind": "lab_result", "label": "HbA1c", "value": "6.5 %", "flag": "high" },
        { "kind": "medication", "label": "Amlodipine", "value": "10 mg · OD" },
        { "kind": "diagnosis", "label": "Hypertension", "value": "active" }
      ]
    }
  ]
}
```
Documents without any date use `created_at`'s date.

### Labs
`GET /api/profiles/{pid}/labs` →
```json
{ "tests": [ { "code": "hba1c", "name": "HbA1c", "unit": "%", "count": 3,
               "latest": {LabPoint}, "previous": {LabPoint}|null, "trend": "up" } ] }   // trend: up|down|flat|null
```
Unrecognized tests are grouped with `code` = `"raw:" + lower(test_name_original)`.

`GET /api/profiles/{pid}/labs/{code}` →
```json
{ "test": { "code": "hba1c", "name": "HbA1c", "unit": "%" },
  "results": [LabPoint] }                                                // oldest first
```
**LabPoint** `{ "id", "value": 6.5|null, "value_text": null, "unit": "%", "reference_low", "reference_high", "flag", "measured_at": "2026-09-02", "document_id", "test_name_original", "value_original", "unit_original" }`

### Medications
`GET /api/profiles/{pid}/medications` →
```json
{
  "current": [Medication], "past": [Medication]
}
```
**Medication**
```json
{
  "id": "…", "canonical_key": "amlodipine", "generic_name": "Amlodipine",
  "status": "active",                    // active | course_completed | not_in_latest
  "latest": {MedicationEvent},
  "history": [MedicationEvent]           // newest first
}
```
**MedicationEvent** `{ "id", "document_id", "prescribed_at", "brand_name", "name_original", "form", "dose_value", "dose_unit", "frequency_code", "times_per_day", "schedule", "timing", "duration_days", "instructions" }`

Status rules (in order):
1. `course_completed` — the latest mention is a **short course** (duration ≤ 14 days) whose
   `prescribed_at + duration_days` is before today (antibiotics, PPIs, antiemetics).
2. `active` (listed under **current**) — it appears in the most recent prescription-like
   document (prescription or discharge_summary with ≥1 accepted medication). Longer durations
   such as "× 30 days" are treated as refill intervals for maintenance therapy, not as an end.
3. `not_in_latest` — otherwise; the UI asks the user to confirm whether it was stopped.
Phase 3 will turn this into proper change detection.

### Health
`GET /api/health` → `{ "status": "ok", "db": "ok", "redis": "ok", "storage": "ok", "ai": "ok"|"unavailable" }`

### Retry state
Between automatic retries a document is `status: "queued"`, `stage: "queued"` with `error`
set to a user-facing explanation ("Attempt 1 failed (…) — retrying automatically."); the
failed step stays visible in `steps`. After the final attempt it becomes `failed`.
