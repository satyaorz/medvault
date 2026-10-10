import { parseISO } from "date-fns"

import type { LabFlag, LabPoint } from "@/lib/types"

export interface LabChartDatum {
  t: number
  value: number
  flag: LabFlag | null
  /** [low, high] for the shaded reference band; null where the report gave no full range. */
  range: [number, number] | null
  point: LabPoint
}

export interface LabChartModel {
  data: LabChartDatum[]
  /** True when every plotted point has a full range → draw a per-point band. */
  perPointBand: boolean
  /** Fallback band from the latest point when ranges are partial/missing on some points. */
  band: { low: number | null; high: number | null } | null
  domain: [number, number]
  nonNumericCount: number
}

/** Shape lab results for the trend chart. Pure → unit-tested. */
export function buildLabChartModel(results: LabPoint[]): LabChartModel {
  const numeric = results
    .filter((r): r is LabPoint & { value: number } => r.value !== null && Number.isFinite(r.value))
    .map<LabChartDatum>((r) => ({
      t: parseISO(r.measured_at).getTime(),
      value: r.value,
      flag: r.flag,
      range: r.reference_low !== null && r.reference_high !== null ? [r.reference_low, r.reference_high] : null,
      point: r,
    }))
    .filter((d) => Number.isFinite(d.t))
    .sort((a, b) => a.t - b.t)

  const perPointBand = numeric.length > 0 && numeric.every((d) => d.range !== null)
  const latest = numeric.at(-1)?.point
  const band =
    !perPointBand && latest && (latest.reference_low !== null || latest.reference_high !== null)
      ? { low: latest.reference_low, high: latest.reference_high }
      : null

  const ys = numeric.flatMap((d) => [d.value, ...(d.range ?? [])])
  if (band?.low !== null && band?.low !== undefined) ys.push(band.low)
  if (band?.high !== null && band?.high !== undefined) ys.push(band.high)
  const min = ys.length ? Math.min(...ys) : 0
  const max = ys.length ? Math.max(...ys) : 1
  const pad = (max - min || Math.abs(max) || 1) * 0.12
  const lower = min >= 0 ? Math.max(0, min - pad) : min - pad

  return {
    data: numeric,
    perPointBand,
    band,
    domain: [niceFloor(lower), niceCeil(max + pad)],
    nonNumericCount: results.length - numeric.length,
  }
}

function niceFloor(n: number) {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(n) || 1)) - 1)
  return Math.floor(n / mag) * mag
}
function niceCeil(n: number) {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(n) || 1)) - 1)
  return Math.ceil(n / mag) * mag
}
