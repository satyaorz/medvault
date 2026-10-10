# MedVault AI service

Stateless Python/FastAPI service that turns medical documents into structured, normalized
facts. It implements `docs/CONTRACTS.md` §2 and **never touches the database**: the Go
worker validates everything it returns and is the only writer of medical data.

```
file ──► /ocr ──► text ──► /classify ──► doc_type ──► /extract ──► items (+confidence, grounding, issues)
         PDF text layer           keyword scoring            LLM or rules  → "as written" fields
         or Tesseract             (+ LLM tie-break)          normalizers   → canonical units / generics / dosing
         (deskew + denoise)                                  grounding     → is source_text really on the page?
```

## Design decisions

| Decision | Why |
|---|---|
| **The LLM only transcribes; tested code interprets.** The LLM schema asks for fields *as written* (`"1-0-1"`, `"HGB"`, `"g/L"`, `"Pan 40"`). Deterministic normalizers turn them into `BD`, `hemoglobin`, `13.2 g/dL`, `Pantoprazole 40 mg`. | In a local benchmark `qwen3.5:9b` read `1-0-1` as three times a day (it means morning + night = twice). Medical semantics shouldn't depend on a sampling temperature. |
| **Rules extractor as a first-class provider** | Works offline in ~0.5 s/document, is the test oracle and the evaluation baseline. |
| **LLM + rules ensemble** | When an LLM is used, facts found by both get confidence 0.96, by one only keep that extractor's confidence, and **disagreements on the same fact** (e.g. a different value for the same test) are capped at 0.7 with an issue naming both readings → human review. |
| **Compact LLM output with line citations** | A laptop GPU runs llama3.1:8b at ~6 tokens/s. The model gets numbered OCR lines and answers with one pipe-delimited row per fact (`"12\|HGB\|136\|g/L\|130 - 170\|"`) inside a JSON-schema-constrained object, about 3× fewer tokens than one JSON object per fact. The cited line is resolved back to verbatim text, and must contain the extracted value. |
| **Latency-budget routing** | The Ollama provider tracks its measured tokens/s; if a document's estimated generation time exceeds `LLM_BUDGET_SECONDS` (rows × ~22 tokens), it goes straight to the rules path instead of timing out. |
| **Grounding check** | Every item carries a verbatim `source_text`; if it can't be found in the OCR text (fuzzy, whitespace/punctuation-insensitive) the item is capped at 0.4 and flagged, which catches hallucinations. |
| **Confidence = min(extractor, normalization ceiling, grounding cap) × OCR factor** | Each reduction adds a human-readable `issue`. The worker auto-accepts only at ≥ 0.85, grounded, with no issues; everything else goes to the review screen. |
| **Plausibility windows per test** | OCR loves dropping decimal points (`Albumin 4.5` → `45`). Values outside a physiological window are flagged instead of silently stored. |
| **OCR-look-alike matching** | `Amiong` → Amlong, `HbAlc` → HbA1c are matched but marked *approximate* (→ review), never auto-accepted. |

## Normalization data

* `app/data/lab_tests.json` — 49 tests (CBC, diabetes, lipids, kidney, liver, thyroid,
  electrolytes, vitamins, iron, CRP) with ~400 aliases, canonical units, unit conversions
  (g/L→g/dL, mmol/L→mg/dL per analyte, µmol/L, IFCC mmol/mol→% HbA1c, `/cumm`, `lakhs/cumm`,
  nmol/L…), typical reference ranges and plausibility windows.
* `app/data/medicines.json` — 140 Indian brand families (~350 brand spellings) → generics,
  including combinations (`Augmentin` → amoxicillin+clavulanate, `Pan-D` →
  domperidone+pantoprazole), plus 86 generic names.
* `app/normalize/frequency.py` — `1-0-1`, `½-0-½`, OD/BD/TDS/QID/HS/SOS/STAT/weekly,
  BF/AF/AC/PC, durations (`x 5 days`, `for 2 weeks`, `1 month`).

## Running

```bash
cd ai-service
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt   # needs tesseract installed
.venv/bin/uvicorn app.main:app --port 8000
curl localhost:8000/health
curl -F file=@eval/demo/04_2026-05-21_sunrise_blood_test.pdf localhost:8000/ocr
```

Docker: `docker build -t medvault-ai . && docker run -p 8000:8000 medvault-ai`
(the image includes Tesseract).

### Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `LLM_PROVIDER` | `auto` | `auto` → Anthropic if `ANTHROPIC_API_KEY` is set, else Ollama if the model is pulled and reachable, else rules. Or force `ollama` / `anthropic` / `rules`. Any LLM failure at request time falls back to rules. |
| `OLLAMA_URL` | `http://localhost:11434` | From Docker use `http://host.docker.internal:11434` and start Ollama with `OLLAMA_HOST=0.0.0.0`. |
| `OLLAMA_MODEL` | `llama3.1:8b` | Must support JSON-schema structured outputs. |
| `OLLAMA_TIMEOUT` | `240` | Seconds per LLM call. |
| `ANTHROPIC_API_KEY` | – | Enables the Claude provider (official SDK, structured outputs). |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Any current Claude model id. |
| `LLM_MAX_CHARS` | `12000` | OCR text sent to a local LLM (head + tail kept). |
| `LLM_BUDGET_SECONDS` | `180` | Skip the local LLM when its estimated generation time is longer. |
| `MAX_UPLOAD_MB` / `MAX_PDF_PAGES` | `25` / `30` | Input limits. |

## Tests

```bash
.venv/bin/python -m pytest -q        # 175 tests, offline (LLMs are mocked)
```

## Evaluation dataset

`eval/generate_samples.py` produces (seeded, deterministic) **40 labelled synthetic
documents**: 14 lab reports, 14 prescriptions, 8 discharge summaries, 4 other (pharmacy
bill, vaccination card, fitness certificate, OPD receipt). They come in four formats: text-layer
PDF, image-only "scanned" PDF, rotated, blurred phone-photo JPEG, and screenshot PNG, and use
varied aliases, units and layouts. Ground truth is in `<id>.truth.json`.

```bash
.venv/bin/python -m eval.generate_samples              # regenerate eval/dataset + eval/demo
.venv/bin/python -m eval.run_eval --provider rules     # full set, ~25 s
.venv/bin/python -m eval.run_eval --provider ollama --limit 6
```

Results are written to `eval/results/<provider>.{json,md}`. See the project README for the
latest numbers. *Auto-accept precision* is the share of items the worker would accept
without review that are actually correct, and it is the number that validates the
human-in-the-loop threshold.

### Demo patient

`eval/demo/` holds 9 documents for one fictional patient (Arjun Mehta) across Jan–Sep 2026:
HbA1c 5.8 → 6.2 → 6.5 %, hemoglobin 14.2 → 12.4 g/dL, Amlodipine 5 → 10 mg, Atorvastatin
replaced by Rosuvastatin, a penicillin allergy that contradicts an earlier "NKDA", a
second lab printing g/L and mmol/L, a phone photo, a pharmacy bill and a follow-up on
15 Nov 2026. Upload them in order (see `eval/demo/README.md`).

## Limitations

* Tesseract is configured for English only; handwritten prescriptions are out of scope.
* Synthetic documents are cleaner than real-world ones; real scans will score lower.
* Reference ranges are only those printed on the report; no age/sex-specific defaults.
* Vitals (BP, pulse, weight) are not extracted.
* On a 4 GB laptop GPU, llama3.1:8b needs ~40–100 s per document; long lab panels are
  routed to the rules path by the latency budget. A cloud model (Anthropic) has no such limit.
