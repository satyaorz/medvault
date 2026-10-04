-- MedVault schema v1 (Phase 1 + 2)
--
-- Raw documents live in object storage; this database holds metadata, OCR text,
-- AI extraction results (staging: extracted_items) and the structured medical
-- record materialized from *accepted* items only.

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL,
    password_hash text NOT NULL,
    name          text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- A user can keep records for several people (self, parents, children...).
CREATE TABLE profiles (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name          text NOT NULL,
    relationship  text NOT NULL DEFAULT 'self'
                  CHECK (relationship IN ('self','parent','child','spouse','sibling','grandparent','other')),
    date_of_birth date,
    sex           text CHECK (sex IN ('male','female','other')),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profiles_user_idx ON profiles (user_id);

CREATE TABLE documents (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id                uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    filename                  text NOT NULL,
    content_type              text NOT NULL,
    size_bytes                bigint NOT NULL,
    sha256                    text NOT NULL,
    storage_key               text NOT NULL,
    title                     text,
    doc_type                  text NOT NULL DEFAULT 'unknown'
                              CHECK (doc_type IN ('prescription','lab_report','discharge_summary','other','unknown')),
    doc_type_source           text NOT NULL DEFAULT 'ai' CHECK (doc_type_source IN ('ai','user')),
    doc_date                  date,
    doc_date_source           text NOT NULL DEFAULT 'ai' CHECK (doc_date_source IN ('ai','user')),
    source                    text,
    status                    text NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued','processing','needs_review','completed','failed')),
    stage                     text NOT NULL DEFAULT 'queued'
                              CHECK (stage IN ('queued','ocr','classifying','extracting','validating','done','failed')),
    error                     text,
    ocr_text                  text,
    ocr_method                text,
    ocr_confidence            real,
    page_count                integer,
    classification_confidence real,
    extraction_provider       text,
    extraction_model          text,
    search                    tsvector GENERATED ALWAYS AS (
                                  to_tsvector('english',
                                      coalesce(title, '') || ' ' || coalesce(filename, '') || ' ' ||
                                      coalesce(source, '') || ' ' || coalesce(ocr_text, ''))
                              ) STORED,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    UNIQUE (profile_id, sha256)
);
CREATE INDEX documents_profile_date_idx ON documents (profile_id, doc_date DESC NULLS LAST, created_at DESC);
CREATE INDEX documents_search_idx ON documents USING gin (search);

-- Audit trail of the asynchronous processing pipeline, shown in the UI.
CREATE TABLE processing_steps (
    id          bigserial PRIMARY KEY,
    document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    stage       text NOT NULL,
    status      text NOT NULL CHECK (status IN ('running','completed','failed','skipped')),
    message     text,
    started_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);
CREATE INDEX processing_steps_document_idx ON processing_steps (document_id, id);

-- Staging area for everything the AI extracted. Nothing reaches the structured
-- tables below unless the item is accepted (automatically or by the user).
CREATE TABLE extracted_items (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    profile_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    kind        text NOT NULL CHECK (kind IN ('lab_result','medication','diagnosis','allergy','encounter')),
    data        jsonb NOT NULL,
    source_text text,
    confidence  real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    grounded    boolean NOT NULL DEFAULT false,
    issues      jsonb NOT NULL DEFAULT '[]',
    status      text NOT NULL CHECK (status IN ('needs_review','accepted','rejected')),
    reviewed_by text CHECK (reviewed_by IN ('auto','user')),
    position    integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz
);
CREATE INDEX extracted_items_document_idx ON extracted_items (document_id, position);
CREATE INDEX extracted_items_profile_status_idx ON extracted_items (profile_id, status);

-- ---- Structured record (materialized from accepted items) -------------------
-- Dates that are NULL fall back to the document date at query time, so editing
-- a document's date automatically moves its facts on the timeline.

CREATE TABLE lab_results (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id         uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    document_id        uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    item_id            uuid NOT NULL UNIQUE REFERENCES extracted_items (id) ON DELETE CASCADE,
    code               text NOT NULL,
    name               text NOT NULL,
    test_name_original text,
    value              double precision,
    value_text         text,
    unit               text,
    value_original     double precision,
    unit_original      text,
    reference_low      double precision,
    reference_high     double precision,
    flag               text CHECK (flag IN ('low','normal','high')),
    measured_at        date
);
CREATE INDEX lab_results_profile_code_idx ON lab_results (profile_id, code);

CREATE TABLE medications (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id    uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    canonical_key text NOT NULL,
    generic_name  text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (profile_id, canonical_key)
);

CREATE TABLE medication_events (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    medication_id  uuid NOT NULL REFERENCES medications (id) ON DELETE CASCADE,
    profile_id     uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    document_id    uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    item_id        uuid NOT NULL UNIQUE REFERENCES extracted_items (id) ON DELETE CASCADE,
    brand_name     text,
    name_original  text,
    form           text,
    dose_value     double precision,
    dose_unit      text,
    frequency_code text,
    times_per_day  integer,
    schedule       text,
    timing         text,
    duration_days  integer,
    instructions   text
);
CREATE INDEX medication_events_profile_idx ON medication_events (profile_id);

CREATE TABLE conditions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    item_id     uuid NOT NULL UNIQUE REFERENCES extracted_items (id) ON DELETE CASCADE,
    name        text NOT NULL,
    status      text
);
CREATE INDEX conditions_profile_idx ON conditions (profile_id);

CREATE TABLE allergies (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    item_id     uuid NOT NULL UNIQUE REFERENCES extracted_items (id) ON DELETE CASCADE,
    substance   text NOT NULL,
    reaction    text
);
CREATE INDEX allergies_profile_idx ON allergies (profile_id);

CREATE TABLE encounters (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    item_id     uuid NOT NULL UNIQUE REFERENCES extracted_items (id) ON DELETE CASCADE,
    type        text NOT NULL CHECK (type IN ('visit','admission','discharge','follow_up')),
    date        date,
    facility    text,
    doctor      text,
    notes       text
);
CREATE INDEX encounters_profile_idx ON encounters (profile_id, type, date);
