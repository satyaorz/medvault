import { DIAGNOSIS_STATUS_LABELS, ENCOUNTER_TYPE_LABELS, FORM_LABELS, TIMING_LABELS } from "@/lib/constants"
import { formatDate, formatDuration, formatLabValue, formatReferenceRange, summarizeMedication } from "@/lib/format"
import type { ExtractedItem, ItemKind, LabFlag } from "@/lib/types"

export interface ItemSummary {
  label: string
  value: string
  detail: string | null
  flag: LabFlag | null
}

/** One-line human summary for any extracted item, used in lists and review cards. */
export function summarizeItem(item: ExtractedItem): ItemSummary {
  switch (item.kind) {
    case "lab_result": {
      const d = item.data
      const range = formatReferenceRange(d.reference_low, d.reference_high, d.unit)
      const renamed = d.canonical_name && d.canonical_name.toLowerCase() !== d.test_name_original.toLowerCase()
      return {
        label: d.canonical_name ?? d.test_name_original,
        value: formatLabValue(d),
        detail: [renamed ? `as “${d.test_name_original}”` : null, range ? `ref ${range}` : null].filter(Boolean).join(" · ") || null,
        flag: d.flag,
      }
    }
    case "medication": {
      const d = item.data
      const extras = [
        d.brand_name,
        d.form ? FORM_LABELS[d.form] : null,
        d.schedule,
        d.timing ? TIMING_LABELS[d.timing] : null,
        formatDuration(d.duration_days),
      ].filter(Boolean)
      return { label: d.generic_name, value: summarizeMedication(d), detail: extras.join(" · ") || null, flag: null }
    }
    case "diagnosis":
      return {
        label: item.data.name,
        value: item.data.status ? DIAGNOSIS_STATUS_LABELS[item.data.status] : "",
        detail: null,
        flag: null,
      }
    case "allergy":
      return { label: item.data.substance, value: item.data.reaction ?? "", detail: null, flag: null }
    case "encounter": {
      const d = item.data
      return {
        label: ENCOUNTER_TYPE_LABELS[d.type],
        value: formatDate(d.date, ""),
        detail: [d.doctor, d.facility, d.notes].filter(Boolean).join(" · ") || null,
        flag: null,
      }
    }
  }
}

export function groupByKind<T extends { kind: ItemKind }>(items: T[]): Map<ItemKind, T[]> {
  const groups = new Map<ItemKind, T[]>()
  for (const item of items) {
    const list = groups.get(item.kind) ?? []
    list.push(item)
    groups.set(item.kind, list)
  }
  return groups
}
