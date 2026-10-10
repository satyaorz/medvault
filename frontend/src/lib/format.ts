import { differenceInYears, format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns"

import { AUTO_ACCEPT_CONFIDENCE, FREQUENCY_LABELS, TIMING_LABELS } from "@/lib/constants"
import type {
  DocStatus,
  FrequencyCode,
  LabFlag,
  LabPoint,
  MedDocument,
  MedicationEvent,
  MedicationTiming,
  Trend,
} from "@/lib/types"

// ── Dates ────────────────────────────────────────────────────────────────────

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : parseISO(value)
  return isValid(date) ? date : null
}

/** `2026-01-12` → `12 Jan 2026`. Returns `fallback` for missing/invalid dates. */
export function formatDate(value: string | Date | null | undefined, fallback = "—"): string {
  const date = toDate(value)
  return date ? format(date, "d MMM yyyy") : fallback
}

export function formatShortDate(value: string | Date | null | undefined, fallback = "—"): string {
  const date = toDate(value)
  return date ? format(date, "d MMM") : fallback
}

export function formatMonthYear(value: string | Date | null | undefined, fallback = "Undated"): string {
  const date = toDate(value)
  return date ? format(date, "MMMM yyyy") : fallback
}

export function formatDateTime(value: string | Date | null | undefined, fallback = "—"): string {
  const date = toDate(value)
  return date ? format(date, "d MMM yyyy, HH:mm") : fallback
}

export function formatRelative(value: string | Date | null | undefined, fallback = "—"): string {
  const date = toDate(value)
  return date ? formatDistanceToNowStrict(date, { addSuffix: true }) : fallback
}

export function ageFromDob(dob: string | null | undefined, now = new Date()): number | null {
  const date = toDate(dob)
  return date ? differenceInYears(now, date) : null
}

/** Today as `YYYY-MM-DD` in local time (for date input max/defaults). */
export function todayISO(now = new Date()): string {
  return format(now, "yyyy-MM-dd")
}

// ── Numbers & sizes ──────────────────────────────────────────────────────────

/** Trim floating noise: 6.5000001 → "6.5", 120 → "120", 0.123456 → "0.123". */
export function formatNumber(value: number, maxFractionDigits = 2): string {
  if (!Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  const digits = abs !== 0 && abs < 1 ? Math.max(maxFractionDigits, 3) : maxFractionDigits
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, useGrouping: abs >= 10000 }).format(value)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

export function formatPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—"
  return `${Math.round(fraction * 100)}%`
}

// ── Labs ─────────────────────────────────────────────────────────────────────

export function withUnit(value: string, unit: string | null | undefined): string {
  if (!unit) return value
  return unit === "%" ? `${value}%` : `${value} ${unit}`
}

/** Normalized value for display: `6.5%`, `13.2 g/dL`, or the text result (`Positive`). */
export function formatLabValue(point: Pick<LabPoint, "value" | "value_text" | "unit">): string {
  if (point.value !== null && point.value !== undefined) return withUnit(formatNumber(point.value), point.unit)
  if (point.value_text) return point.value_text
  return "—"
}

/** As printed on the report: `HGB · 132 g/L`. */
export function formatOriginalLab(
  point: Pick<LabPoint, "test_name_original" | "value_original" | "unit_original">,
): string {
  const value =
    point.value_original === null || point.value_original === undefined
      ? "—"
      : typeof point.value_original === "number"
        ? formatNumber(point.value_original, 4)
        : point.value_original
  return `${point.test_name_original} · ${withUnit(value, point.unit_original)}`
}

export function formatReferenceRange(low: number | null | undefined, high: number | null | undefined, unit?: string | null): string | null {
  const hasLow = low !== null && low !== undefined
  const hasHigh = high !== null && high !== undefined
  if (hasLow && hasHigh) return withUnit(`${formatNumber(low)}–${formatNumber(high)}`, unit)
  if (hasLow) return withUnit(`≥ ${formatNumber(low)}`, unit)
  if (hasHigh) return withUnit(`≤ ${formatNumber(high)}`, unit)
  return null
}

export interface LabDelta {
  delta: number
  direction: Trend
  /** e.g. "+0.3%" / "−1.4 g/dL" */
  label: string
}

/** Difference between two lab points (null when either value is non-numeric). */
export function computeDelta(latest: Pick<LabPoint, "value" | "unit">, previous: Pick<LabPoint, "value"> | null | undefined): LabDelta | null {
  if (!previous || latest.value === null || previous.value === null) return null
  const delta = latest.value - previous.value
  const scale = Math.max(Math.abs(latest.value), Math.abs(previous.value), 1e-9)
  const direction: Trend = Math.abs(delta) / scale < 0.01 ? "flat" : delta > 0 ? "up" : "down"
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±"
  return { delta, direction, label: `${sign}${withUnit(formatNumber(Math.abs(delta)), latest.unit)}` }
}

export const FLAG_LABELS: Record<LabFlag, string> = { low: "Low", normal: "Normal", high: "High" }

/** Tailwind classes for a lab flag (text + soft background). */
export function flagClasses(flag: LabFlag | null | undefined): string {
  switch (flag) {
    case "high":
      return "bg-destructive/10 text-destructive border-destructive/20"
    case "low":
      return "bg-warning/15 text-warning-foreground dark:text-warning border-warning/30"
    case "normal":
      return "bg-success/10 text-success border-success/20"
    default:
      return "bg-muted text-muted-foreground border-border"
  }
}

/** CSS color variable for chart points. */
export function flagColor(flag: LabFlag | null | undefined): string {
  switch (flag) {
    case "high":
      return "var(--destructive)"
    case "low":
      return "var(--warning)"
    case "normal":
      return "var(--success)"
    default:
      return "var(--muted-foreground)"
  }
}

// ── Medications ──────────────────────────────────────────────────────────────

export interface ScheduleSlot {
  label: string
  /** Dose for this slot as written, e.g. "1", "½", "2". */
  amount: string
  active: boolean
}

const SLOT_LABELS: Record<number, string[]> = {
  3: ["Morning", "Afternoon", "Night"],
  4: ["Morning", "Afternoon", "Evening", "Night"],
}

/**
 * Parse an Indian-style dosing schedule: "1-0-1" = morning & night; "1-1-1-1" uses four slots.
 * Accepts "-", "–", "/" or spaces as separators and fractions like "½" or "0.5".
 * Returns null when the string isn't a schedule.
 */
export function parseSchedule(schedule: string | null | undefined): ScheduleSlot[] | null {
  if (!schedule) return null
  const parts = schedule
    .trim()
    .split(/\s*[-–/]\s*|\s+/)
    .filter(Boolean)
  const labels = SLOT_LABELS[parts.length]
  if (!labels) return null
  if (!parts.every((p) => /^(\d+(\.\d+)?|½|¼|¾|\d+\/\d+)$/.test(p))) return null
  return parts.map((amount, i) => ({
    label: labels[i],
    amount,
    active: !/^0+(\.0+)?$/.test(amount),
  }))
}

export function frequencyLabel(code: FrequencyCode | null | undefined): string | null {
  return code ? FREQUENCY_LABELS[code] : null
}

export function timingLabel(timing: MedicationTiming | null | undefined): string | null {
  return timing ? TIMING_LABELS[timing] : null
}

export function formatDose(value: number | null | undefined, unit: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return withUnit(formatNumber(value), unit)
}

export function formatDuration(days: number | null | undefined): string | null {
  if (days === null || days === undefined) return null
  if (days === 1) return "1 day"
  if (days % 30 === 0 && days >= 60) return `${days / 30} months`
  if (days % 7 === 0 && days >= 14) return `${days / 7} weeks`
  return `${days} days`
}

/** "10 mg · OD" — compact summary used in history rows and timeline chips. */
export function summarizeMedication(event: Pick<MedicationEvent, "dose_value" | "dose_unit" | "frequency_code" | "schedule">): string {
  const parts = [formatDose(event.dose_value, event.dose_unit), event.frequency_code ?? event.schedule].filter(Boolean)
  return parts.length ? parts.join(" · ") : "Dose not specified"
}

// ── Documents & items ────────────────────────────────────────────────────────

export function isInFlight(status: DocStatus): boolean {
  return status === "queued" || status === "processing"
}

export function documentTitle(doc: Pick<MedDocument, "title" | "filename">): string {
  return doc.title?.trim() || doc.filename
}

export type ConfidenceLevel = "high" | "medium" | "low"

export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= AUTO_ACCEPT_CONFIDENCE) return "high"
  if (confidence >= 0.6) return "medium"
  return "low"
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}
