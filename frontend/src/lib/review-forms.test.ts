import { describe, expect, it } from "vitest"

import {
  NONE,
  buildAcceptPayload,
  canonicalKeyFor,
  computeFlag,
  labFormSchema,
  medicationFormSchema,
  timesPerDay,
  toFormValues,
  toItemData,
} from "@/lib/review-forms"
import type { ExtractedItem, LabResultData, MedicationData } from "@/lib/types"

const lab: LabResultData = {
  test_name_original: "HGB",
  canonical_code: "hemoglobin",
  canonical_name: "Hemoglobin",
  value: 13.2,
  value_text: null,
  unit: "g/dL",
  value_original: 132,
  unit_original: "g/L",
  reference_low: 13,
  reference_high: 17,
  flag: "normal",
  measured_at: "2026-01-12",
}

const med: MedicationData = {
  name_original: "TAB. Pan 40",
  generic_name: "Pantoprazole",
  brand_name: "Pan",
  canonical_key: "pantoprazole",
  form: "tablet",
  dose_value: 40,
  dose_unit: "mg",
  frequency_code: "OD",
  times_per_day: 1,
  schedule: "1-0-0",
  timing: "before_food",
  duration_days: 7,
  instructions: null,
}

function item<K extends ExtractedItem["kind"]>(kind: K, data: unknown): Extract<ExtractedItem, { kind: K }> {
  return {
    id: "i1",
    document_id: "d1",
    profile_id: "p1",
    kind,
    data,
    source_text: "HGB 132 g/L 130-170",
    confidence: 0.6,
    grounded: true,
    issues: [],
    status: "needs_review",
    reviewed_by: null,
    created_at: "2026-01-12T00:00:00Z",
    reviewed_at: null,
  } as unknown as Extract<ExtractedItem, { kind: K }>
}

describe("lab form", () => {
  it("round-trips unchanged data exactly", () => {
    expect(toItemData("lab_result", toFormValues("lab_result", lab), lab)).toEqual(lab)
  })

  it("applies corrections, recomputes the flag and keeps fields the form hides", () => {
    const values = { ...toFormValues("lab_result", lab), value: "11.9" }
    const data = toItemData("lab_result", values, lab)
    expect(data.value).toBe(11.9)
    expect(data.flag).toBe("low")
    expect(data.value_original).toBe(132)
    expect(data.unit_original).toBe("g/L")
  })

  it("re-derives the canonical code when the standard name is changed or cleared", () => {
    const renamed = toItemData("lab_result", { ...toFormValues("lab_result", lab), canonical_name: "Haemoglobin A" }, lab)
    expect(renamed.canonical_code).toBe("haemoglobin_a")
    const cleared = toItemData("lab_result", { ...toFormValues("lab_result", lab), canonical_name: "" }, lab)
    expect(cleared.canonical_code).toBeNull()
  })

  it("validates numeric input and range ordering", () => {
    const base = toFormValues("lab_result", lab)
    expect(labFormSchema.safeParse(base).success).toBe(true)
    expect(labFormSchema.safeParse({ ...base, value: "abc" }).success).toBe(false)
    expect(labFormSchema.safeParse({ ...base, value: "", value_text: "" }).success).toBe(false)
    expect(labFormSchema.safeParse({ ...base, value: "", value_text: "Positive" }).success).toBe(true)
    const swapped = labFormSchema.safeParse({ ...base, reference_low: "20", reference_high: "10" })
    expect(swapped.success).toBe(false)
  })
})

describe("medication form", () => {
  it("round-trips unchanged data", () => {
    expect(toItemData("medication", toFormValues("medication", med), med)).toEqual(med)
  })

  it("uses the NONE sentinel for missing select values and maps it back to null", () => {
    const values = toFormValues("medication", { ...med, timing: null, form: null })
    expect(values.timing).toBe(NONE)
    expect(values.form).toBe(NONE)
    const data = toItemData("medication", values, { ...med, timing: null, form: null })
    expect(data.timing).toBeNull()
    expect(data.form).toBeNull()
  })

  it("recomputes canonical key and times per day from the schedule", () => {
    const values = { ...toFormValues("medication", med), generic_name: "Amoxicillin + Clavulanate", schedule: "1-0-1", frequency_code: "BD" as const }
    const data = toItemData("medication", values, med)
    expect(data.canonical_key).toBe("amoxicillin+clavulanate")
    expect(data.times_per_day).toBe(2)
  })

  it("rejects malformed schedules and fractional durations", () => {
    const base = toFormValues("medication", med)
    expect(medicationFormSchema.safeParse(base).success).toBe(true)
    expect(medicationFormSchema.safeParse({ ...base, schedule: "morning" }).success).toBe(false)
    expect(medicationFormSchema.safeParse({ ...base, duration_days: "2.5" }).success).toBe(false)
    expect(medicationFormSchema.safeParse({ ...base, dose_value: "-5" }).success).toBe(false)
  })
})

describe("helpers", () => {
  it("computes flags from ranges", () => {
    expect(computeFlag(5, 1, 10, null)).toBe("normal")
    expect(computeFlag(11, 1, 10, null)).toBe("high")
    expect(computeFlag(0.5, 1, null, null)).toBe("low")
    expect(computeFlag(5, null, null, "high")).toBe("high")
    expect(computeFlag(null, 1, 10, "low")).toBe("low")
  })
  it("builds canonical keys like the contract", () => {
    expect(canonicalKeyFor("Pantoprazole")).toBe("pantoprazole")
    expect(canonicalKeyFor(" Amoxicillin +  Clavulanate ")).toBe("amoxicillin+clavulanate")
  })
  it("derives times per day", () => {
    expect(timesPerDay("TDS", null, null)).toBe(3)
    expect(timesPerDay("SOS", null, 1)).toBe(1)
    expect(timesPerDay(null, "1-1-1-1", null)).toBe(4)
  })
})

describe("buildAcceptPayload", () => {
  it("omits data when nothing changed", () => {
    const it1 = item("lab_result", lab)
    expect(buildAcceptPayload(it1, toFormValues("lab_result", lab))).toEqual({ action: "accept" })
  })
  it("includes corrected data when the user edited a field", () => {
    const it1 = item("medication", med)
    const payload = buildAcceptPayload(it1, { ...toFormValues("medication", med), dose_value: "20" })
    expect(payload.action).toBe("accept")
    expect(payload.data).toMatchObject({ dose_value: 20, generic_name: "Pantoprazole" })
  })
  it("handles diagnosis, allergy and encounter kinds", () => {
    const dx = item("diagnosis", { name: "Hypertension", status: "active" })
    expect(buildAcceptPayload(dx, { name: "Essential hypertension", status: "active" }).data).toEqual({
      name: "Essential hypertension",
      status: "active",
    })
    const al = item("allergy", { substance: "Penicillin", reaction: null })
    expect(buildAcceptPayload(al, { substance: "Penicillin", reaction: "Rash" }).data).toEqual({ substance: "Penicillin", reaction: "Rash" })
    const enc = item("encounter", { type: "follow_up", date: "2026-09-14", facility: null, doctor: "Dr. A", notes: null })
    expect(buildAcceptPayload(enc, toFormValues("encounter", enc.data))).toEqual({ action: "accept" })
  })
})
