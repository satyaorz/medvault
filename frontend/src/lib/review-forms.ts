/**
 * Form models for the human-in-the-loop review screen.
 *
 * Form values are plain strings (what inputs produce); `toItemData` converts them back into the
 * contract payload for the item's kind, preserving fields the form doesn't expose
 * (e.g. `value_original`, `canonical_code`). The Go API re-validates whatever we send.
 */
import { z } from "zod"

import {
  DIAGNOSIS_STATUSES,
  ENCOUNTER_TYPES,
  FREQUENCY_CODES,
  MEDICATION_FORMS,
  TIMINGS,
} from "@/lib/constants"
import { parseSchedule } from "@/lib/format"
import { optionalIsoDate } from "@/lib/validation"
import type {
  AllergyData,
  DiagnosisData,
  EncounterData,
  ExtractedItem,
  FrequencyCode,
  ItemDataByKind,
  ItemKind,
  LabFlag,
  LabResultData,
  MedicationData,
} from "@/lib/types"

/** Radix Select can't hold "" — this sentinel means "not specified". */
export const NONE = "__none"

const optionalNumber = z
  .string()
  .trim()
  .refine((v) => v === "" || Number.isFinite(Number(v)), "Enter a number")
const optionalNonNegative = optionalNumber.refine((v) => v === "" || Number(v) >= 0, "Can't be negative")
const optionalEnum = <T extends string>(values: readonly T[]) =>
  z.union([z.literal(NONE), z.enum(values as unknown as [T, ...T[]])])

const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters`)

// ── Lab result ───────────────────────────────────────────────────────────────

export const labFormSchema = z
  .object({
    test_name_original: text(120).min(1, "Enter the test name"),
    canonical_name: text(120),
    value: optionalNumber,
    value_text: text(120),
    unit: text(40),
    reference_low: optionalNumber,
    reference_high: optionalNumber,
    measured_at: optionalIsoDate,
  })
  .refine((v) => v.value !== "" || v.value_text !== "", {
    message: "Enter a numeric value or a text result",
    path: ["value"],
  })
  .refine((v) => v.reference_low === "" || v.reference_high === "" || Number(v.reference_low) <= Number(v.reference_high), {
    message: "Low must not exceed high",
    path: ["reference_high"],
  })
export type LabFormValues = z.infer<typeof labFormSchema>

// ── Medication ───────────────────────────────────────────────────────────────

export const medicationFormSchema = z.object({
  generic_name: text(120).min(1, "Enter the medicine name"),
  brand_name: text(120),
  form: optionalEnum(MEDICATION_FORMS),
  dose_value: optionalNonNegative,
  dose_unit: text(20),
  frequency_code: optionalEnum(FREQUENCY_CODES),
  schedule: text(20).refine((v) => v === "" || parseSchedule(v) !== null, "Use a pattern like 1-0-1"),
  timing: optionalEnum(TIMINGS),
  duration_days: optionalNonNegative.refine((v) => v === "" || Number.isInteger(Number(v)), "Whole days only"),
  instructions: text(500),
})
export type MedicationFormValues = z.infer<typeof medicationFormSchema>

// ── Diagnosis / allergy / encounter ──────────────────────────────────────────

export const diagnosisFormSchema = z.object({
  name: text(200).min(1, "Enter the diagnosis"),
  status: optionalEnum(DIAGNOSIS_STATUSES),
})
export type DiagnosisFormValues = z.infer<typeof diagnosisFormSchema>

export const allergyFormSchema = z.object({
  substance: text(120).min(1, "Enter the substance"),
  reaction: text(200),
})
export type AllergyFormValues = z.infer<typeof allergyFormSchema>

export const encounterFormSchema = z.object({
  type: z.enum(ENCOUNTER_TYPES as unknown as ["visit", ...EncounterData["type"][]]),
  date: optionalIsoDate,
  facility: text(200),
  doctor: text(120),
  notes: text(1000),
})
export type EncounterFormValues = z.infer<typeof encounterFormSchema>

export interface FormValuesByKind {
  lab_result: LabFormValues
  medication: MedicationFormValues
  diagnosis: DiagnosisFormValues
  allergy: AllergyFormValues
  encounter: EncounterFormValues
}

export const reviewFormSchemas = {
  lab_result: labFormSchema,
  medication: medicationFormSchema,
  diagnosis: diagnosisFormSchema,
  allergy: allergyFormSchema,
  encounter: encounterFormSchema,
} as const

// ── Conversions ──────────────────────────────────────────────────────────────

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v))
const sel = (v: string | null | undefined) => (v ? v : NONE)
const orNull = (v: string) => (v.trim() === "" ? null : v.trim())
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v))
const selOrNull = <T extends string>(v: string) => (v === NONE || v === "" ? null : (v as T))

export function toFormValues<K extends ItemKind>(kind: K, data: ItemDataByKind[K]): FormValuesByKind[K]
export function toFormValues(kind: ItemKind, data: ItemDataByKind[ItemKind]): FormValuesByKind[ItemKind] {
  switch (kind) {
    case "lab_result": {
      const d = data as LabResultData
      return {
        test_name_original: str(d.test_name_original),
        canonical_name: str(d.canonical_name),
        value: str(d.value),
        value_text: str(d.value_text),
        unit: str(d.unit),
        reference_low: str(d.reference_low),
        reference_high: str(d.reference_high),
        measured_at: str(d.measured_at),
      }
    }
    case "medication": {
      const d = data as MedicationData
      return {
        generic_name: str(d.generic_name),
        brand_name: str(d.brand_name),
        form: sel(d.form),
        dose_value: str(d.dose_value),
        dose_unit: str(d.dose_unit),
        frequency_code: sel(d.frequency_code),
        schedule: str(d.schedule),
        timing: sel(d.timing),
        duration_days: str(d.duration_days),
        instructions: str(d.instructions),
      } as MedicationFormValues
    }
    case "diagnosis": {
      const d = data as DiagnosisData
      return { name: str(d.name), status: sel(d.status) } as DiagnosisFormValues
    }
    case "allergy": {
      const d = data as AllergyData
      return { substance: str(d.substance), reaction: str(d.reaction) }
    }
    case "encounter": {
      const d = data as EncounterData
      return {
        type: d.type ?? "visit",
        date: str(d.date),
        facility: str(d.facility),
        doctor: str(d.doctor),
        notes: str(d.notes),
      }
    }
  }
}

/** Recompute the flag from value + reference range; keep the original when we can't tell. */
export function computeFlag(value: number | null, low: number | null, high: number | null, fallback: LabFlag | null): LabFlag | null {
  if (value === null) return fallback
  if (low === null && high === null) return fallback
  if (low !== null && value < low) return "low"
  if (high !== null && value > high) return "high"
  return "normal"
}

export function slugifyCode(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

/** "Amoxicillin + Clavulanate" → "amoxicillin+clavulanate" (CONTRACTS.md §1). */
export function canonicalKeyFor(genericName: string): string {
  return genericName
    .split("+")
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("+")
}

const TIMES_PER_DAY: Partial<Record<FrequencyCode, number>> = { OD: 1, BD: 2, TDS: 3, QID: 4, HS: 1 }

export function timesPerDay(frequency: FrequencyCode | null, schedule: string | null, fallback: number | null): number | null {
  const slots = parseSchedule(schedule)
  if (slots) return slots.filter((s) => s.active).length
  if (frequency && TIMES_PER_DAY[frequency] !== undefined) return TIMES_PER_DAY[frequency]!
  return fallback
}

export function toItemData<K extends ItemKind>(kind: K, values: FormValuesByKind[K], original: ItemDataByKind[K]): ItemDataByKind[K]
export function toItemData(
  kind: ItemKind,
  values: FormValuesByKind[ItemKind],
  original: ItemDataByKind[ItemKind],
): ItemDataByKind[ItemKind] {
  switch (kind) {
    case "lab_result": {
      const v = values as LabFormValues
      const o = original as LabResultData
      const value = numOrNull(v.value)
      const low = numOrNull(v.reference_low)
      const high = numOrNull(v.reference_high)
      const canonicalName = orNull(v.canonical_name)
      const canonicalCode =
        canonicalName === null ? null : canonicalName === o.canonical_name ? o.canonical_code : slugifyCode(canonicalName)
      return {
        ...o,
        test_name_original: v.test_name_original.trim(),
        canonical_name: canonicalName,
        canonical_code: canonicalCode,
        value,
        value_text: value === null ? orNull(v.value_text) : null,
        unit: orNull(v.unit),
        reference_low: low,
        reference_high: high,
        flag: computeFlag(value, low, high, o.flag),
        measured_at: orNull(v.measured_at),
      } satisfies LabResultData
    }
    case "medication": {
      const v = values as MedicationFormValues
      const o = original as MedicationData
      const frequency = selOrNull<FrequencyCode>(v.frequency_code)
      const schedule = orNull(v.schedule)
      const generic = v.generic_name.trim()
      return {
        ...o,
        generic_name: generic,
        canonical_key: canonicalKeyFor(generic),
        brand_name: orNull(v.brand_name),
        form: selOrNull(v.form),
        dose_value: numOrNull(v.dose_value),
        dose_unit: orNull(v.dose_unit),
        frequency_code: frequency,
        times_per_day: timesPerDay(frequency, schedule, o.times_per_day),
        schedule,
        timing: selOrNull(v.timing),
        duration_days: numOrNull(v.duration_days),
        instructions: orNull(v.instructions),
      } satisfies MedicationData
    }
    case "diagnosis": {
      const v = values as DiagnosisFormValues
      return { ...(original as DiagnosisData), name: v.name.trim(), status: selOrNull(v.status) } satisfies DiagnosisData
    }
    case "allergy": {
      const v = values as AllergyFormValues
      return { ...(original as AllergyData), substance: v.substance.trim(), reaction: orNull(v.reaction) } satisfies AllergyData
    }
    case "encounter": {
      const v = values as EncounterFormValues
      return {
        ...(original as EncounterData),
        type: v.type,
        date: orNull(v.date),
        facility: orNull(v.facility),
        doctor: orNull(v.doctor),
        notes: orNull(v.notes),
      } satisfies EncounterData
    }
  }
}

/** Order-insensitive deep equality for JSON-like payloads. */
export function isSameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) => isSameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** Payload for PATCH /api/items/{id}: include `data` only if the user changed something. */
export function buildAcceptPayload<K extends ItemKind>(
  item: Extract<ExtractedItem, { kind: K }>,
  values: FormValuesByKind[K],
): { action: "accept"; data?: ItemDataByKind[K] } {
  const original = item.data as ItemDataByKind[K]
  const unchanged = isSameData(toFormValues(item.kind as K, original), values)
  if (unchanged) return { action: "accept" }
  return { action: "accept", data: toItemData(item.kind as K, values, original) }
}
