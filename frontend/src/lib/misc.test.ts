import { describe, expect, it } from "vitest"

import { summarizeItem, groupByKind } from "@/lib/items"
import { buildLabChartModel } from "@/lib/lab-chart"
import { safeNextPath } from "@/lib/navigation"
import { sparklinePoints } from "@/lib/sparkline"
import { organizeTimeline } from "@/lib/timeline"
import type { ExtractedItem, LabPoint, TimelineEvent } from "@/lib/types"
import { MAX_UPLOAD_BYTES, validateUploadFile } from "@/lib/upload"
import { loginSchema, profileSchema, registerSchema } from "@/lib/validation"

const point = (over: Partial<LabPoint>): LabPoint => ({
  id: Math.random().toString(),
  value: 6,
  value_text: null,
  unit: "%",
  reference_low: 4,
  reference_high: 5.6,
  flag: "high",
  measured_at: "2026-01-01",
  document_id: "d",
  test_name_original: "HbA1c",
  value_original: 6,
  unit_original: "%",
  ...over,
})

describe("validateUploadFile", () => {
  it("accepts supported types and rejects others", () => {
    expect(validateUploadFile({ name: "a.pdf", size: 100, type: "application/pdf" })).toBeNull()
    expect(validateUploadFile({ name: "scan.JPG", size: 100, type: "" })).toBeNull()
    expect(validateUploadFile({ name: "a.docx", size: 100, type: "application/msword" })).toMatch(/PDF, PNG/)
    expect(validateUploadFile({ name: "a.png", size: 0, type: "image/png" })).toMatch(/empty/)
    expect(validateUploadFile({ name: "a.png", size: MAX_UPLOAD_BYTES + 1, type: "image/png" })).toMatch(/20 MB/)
  })
})

describe("auth & profile schemas", () => {
  it("validates login and registration", () => {
    expect(loginSchema.safeParse({ email: "x@y.co", password: "p" }).success).toBe(true)
    expect(loginSchema.safeParse({ email: "nope", password: "p" }).success).toBe(false)
    const ok = { name: "Satya", email: "s@x.co", password: "password1", confirmPassword: "password1" }
    expect(registerSchema.safeParse(ok).success).toBe(true)
    expect(registerSchema.safeParse({ ...ok, password: "short", confirmPassword: "short" }).success).toBe(false)
    const mismatch = registerSchema.safeParse({ ...ok, confirmPassword: "password2" })
    expect(mismatch.success).toBe(false)
    expect(mismatch.error?.issues[0].path).toEqual(["confirmPassword"])
  })
  it("rejects future birth dates", () => {
    expect(profileSchema.safeParse({ name: "Dad", relationship: "parent", date_of_birth: "1960-04-02", sex: "male" }).success).toBe(true)
    expect(profileSchema.safeParse({ name: "Dad", relationship: "parent", date_of_birth: "2999-01-01", sex: "" }).success).toBe(false)
  })
})

describe("safeNextPath", () => {
  it("only allows same-site paths", () => {
    expect(safeNextPath("/p/1/labs")).toBe("/p/1/labs")
    expect(safeNextPath("//evil.com")).toBeNull()
    expect(safeNextPath("https://evil.com")).toBeNull()
    expect(safeNextPath("/login")).toBeNull()
    expect(safeNextPath(null)).toBeNull()
  })
})

describe("sparklinePoints", () => {
  it("scales values into the box, highest value at the top", () => {
    expect(sparklinePoints([1, 3, 2], 100, 20, 0)).toBe("0,20 50,0 100,10")
  })
  it("centers flat and single-value series", () => {
    expect(sparklinePoints([5, 5], 10, 10, 0)).toBe("0,5 10,5")
    expect(sparklinePoints([5], 10, 10, 0)).toBe("5,5")
    expect(sparklinePoints([], 10, 10)).toBe("")
  })
})

describe("buildLabChartModel", () => {
  it("sorts by date, skips non-numeric results and uses per-point bands when complete", () => {
    const model = buildLabChartModel([
      point({ measured_at: "2026-05-01", value: 6.2 }),
      point({ measured_at: "2026-01-01", value: 5.8, flag: "high" }),
      point({ measured_at: "2026-03-01", value: null, value_text: "Pending" }),
    ])
    expect(model.data.map((d) => d.value)).toEqual([5.8, 6.2])
    expect(model.perPointBand).toBe(true)
    expect(model.band).toBeNull()
    expect(model.nonNumericCount).toBe(1)
    expect(model.domain[0]).toBeLessThanOrEqual(4)
    expect(model.domain[1]).toBeGreaterThanOrEqual(6.2)
  })
  it("falls back to the latest point's one-sided range", () => {
    const model = buildLabChartModel([
      point({ measured_at: "2026-01-01", value: 25, reference_low: null, reference_high: null }),
      point({ measured_at: "2026-02-01", value: 31, reference_low: 30, reference_high: null }),
    ])
    expect(model.perPointBand).toBe(false)
    expect(model.band).toEqual({ low: 30, high: null })
  })
})

describe("organizeTimeline", () => {
  const ev = (id: string, date: string, type: TimelineEvent["type"] = "lab_report"): TimelineEvent => ({
    id,
    date,
    type,
    title: id,
    subtitle: null,
    document_id: null,
    status: "completed",
    highlights: [],
  })
  it("pins future follow-ups and groups the rest by month, newest first", () => {
    const { upcoming, groups } = organizeTimeline(
      [ev("a", "2026-01-12"), ev("b", "2026-09-02"), ev("c", "2026-09-20", "follow_up"), ev("d", "2026-09-01"), ev("e", "2026-02-01", "follow_up")],
      "2026-09-10",
    )
    expect(upcoming.map((e) => e.id)).toEqual(["c"])
    expect(groups.map((g) => g.label)).toEqual(["September 2026", "February 2026", "January 2026"])
    expect(groups[0].events.map((e) => e.id)).toEqual(["b", "d"])
  })
})

describe("summarizeItem", () => {
  it("summarizes a renamed lab with its reference range", () => {
    const item = {
      kind: "lab_result",
      data: {
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
        measured_at: null,
      },
    } as ExtractedItem
    expect(summarizeItem(item)).toEqual({
      label: "Hemoglobin",
      value: "13.2 g/dL",
      detail: "as “HGB” · ref 13–17 g/dL",
      flag: "normal",
    })
  })
  it("groups items by kind preserving order", () => {
    const groups = groupByKind([{ kind: "medication" }, { kind: "lab_result" }, { kind: "medication" }] as { kind: ExtractedItem["kind"] }[])
    expect(groups.get("medication")).toHaveLength(2)
    expect([...groups.keys()]).toEqual(["medication", "lab_result"])
  })
})
