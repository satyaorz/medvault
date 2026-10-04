import { describe, expect, it } from "vitest"

import {
  computeDelta,
  confidenceLevel,
  documentTitle,
  formatBytes,
  formatDate,
  formatDose,
  formatDuration,
  formatLabValue,
  formatNumber,
  formatOriginalLab,
  formatReferenceRange,
  initials,
  isInFlight,
  parseSchedule,
  summarizeMedication,
} from "@/lib/format"

describe("formatNumber", () => {
  it("trims floating point noise", () => {
    expect(formatNumber(6.5000001)).toBe("6.5")
    expect(formatNumber(120)).toBe("120")
    expect(formatNumber(0.12345)).toBe("0.123")
  })
  it("groups large numbers only", () => {
    expect(formatNumber(1500)).toBe("1500")
    expect(formatNumber(250000)).toBe("250,000")
  })
  it("handles non-finite values", () => {
    expect(formatNumber(Number.NaN)).toBe("—")
  })
})

describe("formatBytes", () => {
  it.each([
    [512, "512 B"],
    [2048, "2.0 KB"],
    [182734, "178 KB"],
    [20 * 1024 * 1024, "20 MB"],
  ])("%d → %s", (bytes, label) => expect(formatBytes(bytes)).toBe(label))
})

describe("formatDate", () => {
  it("formats ISO dates and falls back for missing ones", () => {
    expect(formatDate("2026-01-12")).toBe("12 Jan 2026")
    expect(formatDate(null)).toBe("—")
    expect(formatDate("not-a-date", "Undated")).toBe("Undated")
  })
})

describe("parseSchedule", () => {
  it("reads a three-slot schedule (1-0-1 = morning and night)", () => {
    expect(parseSchedule("1-0-1")).toEqual([
      { label: "Morning", amount: "1", active: true },
      { label: "Afternoon", amount: "0", active: false },
      { label: "Night", amount: "1", active: true },
    ])
  })
  it("supports four slots, fractions and other separators", () => {
    const slots = parseSchedule("½ – 0 – ½ – 1")
    expect(slots?.map((s) => s.label)).toEqual(["Morning", "Afternoon", "Evening", "Night"])
    expect(slots?.map((s) => s.active)).toEqual([true, false, true, true])
  })
  it("rejects things that are not schedules", () => {
    expect(parseSchedule("OD")).toBeNull()
    expect(parseSchedule("1-0")).toBeNull()
    expect(parseSchedule("")).toBeNull()
    expect(parseSchedule(null)).toBeNull()
  })
})

describe("lab formatting", () => {
  const point = { value: 13.2, value_text: null, unit: "g/dL" }
  it("formats normalized values, percentages and text results", () => {
    expect(formatLabValue(point)).toBe("13.2 g/dL")
    expect(formatLabValue({ value: 6.5, value_text: null, unit: "%" })).toBe("6.5%")
    expect(formatLabValue({ value: null, value_text: "Positive", unit: null })).toBe("Positive")
  })
  it("shows the value as printed on the report", () => {
    expect(formatOriginalLab({ test_name_original: "HGB", value_original: 132, unit_original: "g/L" })).toBe("HGB · 132 g/L")
    expect(formatOriginalLab({ test_name_original: "HIV", value_original: "Non reactive", unit_original: null })).toBe(
      "HIV · Non reactive",
    )
  })
  it("formats full, one-sided and missing reference ranges", () => {
    expect(formatReferenceRange(13, 17, "g/dL")).toBe("13–17 g/dL")
    expect(formatReferenceRange(null, 5.7, "%")).toBe("≤ 5.7%")
    expect(formatReferenceRange(30, null, "ng/mL")).toBe("≥ 30 ng/mL")
    expect(formatReferenceRange(null, null)).toBeNull()
  })
})

describe("computeDelta", () => {
  it("computes direction and a signed label", () => {
    expect(computeDelta({ value: 6.5, unit: "%" }, { value: 6.2 })).toEqual({
      delta: expect.closeTo(0.3, 5),
      direction: "up",
      label: "+0.3%",
    })
    expect(computeDelta({ value: 12.1, unit: "g/dL" }, { value: 13.8 })?.label).toBe("−1.7 g/dL")
  })
  it("treats sub-1% changes as flat", () => {
    expect(computeDelta({ value: 100.5, unit: "mg/dL" }, { value: 100 })?.direction).toBe("flat")
  })
  it("returns null without a numeric previous value", () => {
    expect(computeDelta({ value: 5, unit: null }, null)).toBeNull()
    expect(computeDelta({ value: 5, unit: null }, { value: null })).toBeNull()
  })
})

describe("medication helpers", () => {
  it("summarizes dose and frequency", () => {
    expect(summarizeMedication({ dose_value: 10, dose_unit: "mg", frequency_code: "OD", schedule: null })).toBe("10 mg · OD")
    expect(summarizeMedication({ dose_value: null, dose_unit: null, frequency_code: null, schedule: "1-0-1" })).toBe("1-0-1")
    expect(summarizeMedication({ dose_value: null, dose_unit: null, frequency_code: null, schedule: null })).toBe(
      "Dose not specified",
    )
  })
  it("formats doses and durations", () => {
    expect(formatDose(500, "mg")).toBe("500 mg")
    expect(formatDose(null, null)).toBeNull()
    expect(formatDose(null, "mg")).toBeNull()
    expect(formatDuration(1)).toBe("1 day")
    expect(formatDuration(5)).toBe("5 days")
    expect(formatDuration(14)).toBe("2 weeks")
    expect(formatDuration(90)).toBe("3 months")
  })
})

describe("misc helpers", () => {
  it("classifies confidence like the worker's auto-accept rule", () => {
    expect(confidenceLevel(0.9)).toBe("high")
    expect(confidenceLevel(0.85)).toBe("high")
    expect(confidenceLevel(0.7)).toBe("medium")
    expect(confidenceLevel(0.3)).toBe("low")
  })
  it("prefers the title over the filename", () => {
    expect(documentTitle({ title: "Blood test", filename: "a.pdf" })).toBe("Blood test")
    expect(documentTitle({ title: "  ", filename: "a.pdf" })).toBe("a.pdf")
  })
  it("builds initials", () => {
    expect(initials("Satya Pradhan")).toBe("SP")
    expect(initials("dad")).toBe("DA")
    expect(initials("")).toBe("?")
  })
  it("knows which statuses are still in flight", () => {
    expect(isInFlight("queued")).toBe(true)
    expect(isInFlight("processing")).toBe(true)
    expect(isInFlight("needs_review")).toBe(false)
  })
})
