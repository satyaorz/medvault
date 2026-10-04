# MedVault — AI-Assisted Personal Health Record

> Upload the prescriptions, lab reports and discharge summaries you already have, as PDFs
> or phone photos. MedVault reads them, organizes them into a **structured timeline**, tracks
> your **lab values across different labs and units**, and keeps an up-to-date
> **medication list**. Every fact links back to the document it came from.

*College minor project, Semester 7. This repository covers **Phase 1** (record storage and
processing pipeline) and **Phase 2** (turning documents into structured data). Phase 3
(change detection and a copilot that answers questions from your records) builds on it.*

⚠️ MedVault organizes records. It does not diagnose, and it is not medical advice.

---

## What it does

| | Feature |
|---|---|
| 🔐 | Accounts, plus **family profiles** (Me / Dad / Mom…), each with its own records |
| 📤 | Drag-and-drop upload (PDF/PNG/JPEG/WEBP, ≤ 20 MB) with progress bars, duplicate detection, search and filters |
| ⚙️ | **Background processing pipeline** with a live progress display (OCR → classify → extract → validate) and automatic retries |
| 🔎 | **OCR**: uses a PDF's own text when it has one, otherwise Tesseract (with straightening and denoising for photos) |
| 🏷️ | **Classification** into prescription, lab report, discharge summary or other |
| 🧠 | **AI extraction** of lab results, medicines, diagnoses, allergies and visits/follow-ups (local LLM via Ollama, Anthropic, or an offline rules engine) |
| 📏 | **Normalization**: `Hb`/`HGB`/`Haemoglobin` → Hemoglobin; `136 g/L` → `13.6 g/dL`; `Pan 40` → Pantoprazole 40 mg; `1-0-1` → twice daily |
| ✅ | **Human-in-the-loop review**: anything uncertain waits for you to confirm or correct it before it enters your record |
| 🗓️ | **Timeline** of visits, tests and prescriptions, with upcoming follow-ups |
| 📈 | **Lab trends**: a chart for each test with its reference range shaded, plus "as printed on the report" values |
| 💊 | **Medications**: current vs past, dose history, morning/afternoon/night schedule, "not in your latest prescription — confirm" |

## How the AI is kept reliable

The LLM is treated as an **untrusted component**:

1. **The LLM only copies text; code interprets it.** The model copies fields exactly as written
   (`"1-0-1"`, `"HGB 136 g/L"`). Tested, deterministic code converts units, maps brands to
   generics and expands dosing shorthand. In our benchmark a 9B model misread `1-0-1` as
   three times a day, which is why the work is split this way.
2. **Grounding check.** Every value must come with the exact quote it was taken from. If that
   quote isn't actually in the document, the value is flagged as a possible hallucination.
3. **Confidence score.** It combines how sure the model was, the grounding check, whether the
   value could be normalized, and the OCR quality. Only values that are ≥ 0.85 confident,
   grounded and have no issues are accepted automatically.
4. **Second validation in Go.** The backend checks every value again (types, allowed values,
   ranges, dates) before anything is saved, including the corrections users make.
5. **Staging before the record.** Extracted values sit in a separate staging table. Only
   accepted ones reach your record, and rejecting one later removes it again.

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for diagrams, the data model and the
security design, and **[docs/CONTRACTS.md](docs/CONTRACTS.md)** for the API specification.

## Architecture

```
Browser ─► Next.js (TypeScript, Tailwind, shadcn/ui) ─► Go REST API ─► PostgreSQL
                                                          │   └──────► S3 storage (SeaweedFS)
                                                          └─► Redis queue ─► Go worker ─► Python AI service
                                                                                         (FastAPI · Tesseract ·
                                                                                          Ollama/Anthropic/rules)
```

| Folder | What | Stack |
|---|---|---|
| `backend/` | REST API + background worker | Go 1.26, chi, pgx, Asynq, minio-go |
| `ai-service/` | OCR, classification, extraction, normalization, evaluation | Python 3.12, FastAPI, PyMuPDF, Tesseract |
| `frontend/` | Web app | Next.js 16, TypeScript, Tailwind v4, shadcn/ui, TanStack Query, Recharts |
| `docs/` | Architecture and API contracts | Markdown, Mermaid |

## Quick start (local development)

**Prerequisites:** Docker, Go ≥ 1.26, Python ≥ 3.12, Node ≥ 22, `tesseract` (with English
data). Optional: [Ollama](https://ollama.com) with `ollama pull llama3.1:8b`.

```bash
make infra        # Postgres, Redis, S3 storage in Docker
make setup        # Go modules, Python venv, npm install

# then, each in its own terminal:
make ai           # AI service      → http://localhost:8000
make api          # Go API          → http://localhost:8080
make worker       # Go worker
make web          # Frontend        → http://localhost:3000
```

Open http://localhost:3000, create an account, and upload documents.

### Or run everything in Docker

```bash
make up           # builds and starts all services → http://localhost:3000
make down
```

Inside Docker, the AI service reaches a host Ollama at `host.docker.internal`. Start Ollama
with `OLLAMA_HOST=0.0.0.0` so containers can reach it, or set `LLM_PROVIDER=rules`.

### Choosing the extraction engine

| `LLM_PROVIDER` | Behaviour |
|---|---|
| `auto` (default) | Anthropic if `ANTHROPIC_API_KEY` is set, otherwise Ollama if it's running, otherwise rules |
| `ollama` | Local model (`OLLAMA_MODEL`, default `llama3.1:8b`) combined with the rules engine; ~40 s/document on a laptop GPU |
| `anthropic` | Claude via API (`ANTHROPIC_MODEL`), combined with the rules engine |
| `rules` | Fully offline and deterministic, ~0.3 s/document. Best for demos without a GPU |

## Demo

`ai-service/eval/demo/` contains 9 documents for a fictional patient covering Jan–Sep 2026:
two different labs (one reports hemoglobin in g/L and glucose in mmol/L), three
prescriptions, a discharge summary with a penicillin allergy, a phone photo of a CBC report,
and a pharmacy bill. Upload them in the order listed in
[its README](ai-service/eval/demo/README.md) to see:

- HbA1c rising 5.8 → 6.2 → 6.5 %, and hemoglobin falling 14.2 → 12.4 g/dL, with results from
  both labs merged into one trend
- Amlodipine dose history 5 → 10 mg; Atorvastatin flagged *"not in your latest prescription"*
  after the switch to Rosuvastatin
- An OCR misread on the phone photo (`10³/µL` read as `1043/pL`) sent to **Review** rather than
  silently saved
- A follow-up on 15 Nov 2026 pinned at the top of the timeline

## Testing

```bash
make test           # everything
make test-backend   # Go: unit + integration tests against real Postgres (needs `make infra`)
make test-ai        # Python: 177 tests
make test-web       # Frontend: typecheck, lint, 70 Vitest tests
make eval           # extraction accuracy on the labelled dataset
```

The Go integration tests run the real router, database and pipeline with a scripted fake AI
service. They cover auth, isolation between users (one user can't reach another's records),
upload validation, the review workflow, reprocessing and deletion. CI runs all three suites
(`.github/workflows/ci.yml`).

## Evaluation

The dataset is 40 labelled synthetic Indian-style documents (`ai-service/eval/dataset/`):
20 text PDFs, 8 scanned PDFs, 8 phone photos and 4 screenshots.

| Engine | Docs | Type accuracy | Lab F1 | Medication F1 | Auto-accept precision | Time/doc |
|---|---:|---:|---:|---:|---:|---:|
| Rules (offline) | 40 | 1.00 | 0.976 | 0.986 | 0.996 | 0.3 s |
| Ollama llama3.1:8b + rules | 6* | 1.00 | 1.000 | 0.875 | 1.000 | 38 s |

\* a type-balanced subset, because the local model is slow. *Auto-accept precision* is the
share of automatically accepted values that are correct. It is the number that matters for
safety, because everything else goes through human review.

**Read these numbers with care.** The documents are synthetic and cleaner than real scans,
and the same team wrote both the generator and the rules engine. Expect lower accuracy on
real-world documents, and use the review screen.

## Project structure

```
backend/
  cmd/api, cmd/worker        entry points
  internal/api               HTTP handlers, auth & rate-limit middleware, integration tests
  internal/pipeline          OCR → classify → extract → validate job
  internal/extraction        validation of all AI output and user corrections
  internal/store             PostgreSQL access (ownership enforced in SQL)
  internal/db/migrations     schema
ai-service/
  app/ocr.py, classify.py    OCR and document classification
  app/extract/               LLM providers, rules extractor, ensemble pipeline
  app/normalize/             lab, medicine, dosing, date normalizers + grounding
  app/data/                  lab test and medicine dictionaries
  eval/                      dataset generator, demo set, evaluation harness, results
frontend/src/
  app/                       routes (login, profiles, /p/[profileId]/…)
  components/                UI by feature area
  lib/                       typed API client, contract types, helpers
docs/                        ARCHITECTURE.md, CONTRACTS.md
```

## Roadmap — Phase 3

- **Cross-document change detection**: new, stopped or changed medicines, significant lab
  movements and new diagnoses, run on every upload. This builds on `medication_events` and the
  lab history.
- **Conflict alerts**, e.g. "Penicillin allergy" in one record and "No known allergies" in
  another.
- A **copilot** that answers questions from your own records: SQL for facts, pgvector search
  for free text, always with source links.
- A one-page **doctor summary** and **time-limited sharing links**.

## Known limitations

- English OCR only, and no handwritten prescriptions.
- Vitals (BP, pulse, weight) are not extracted yet.
- When a report prints no reference range, a typical adult range is used for the flag.
- Medication status uses simple rules for now (a short course ends; otherwise it's current if
  it's in the latest prescription). Phase 3 replaces this with change detection.
