import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { diffDocumentPatch } from "@/components/documents/document-details-form"
import { ProcessingStepper, buildStepperRows } from "@/components/documents/processing-stepper"
import type { DocumentDetail } from "@/lib/types"

const base = { steps: [] } as unknown as DocumentDetail

describe("buildStepperRows", () => {
  it("marks earlier stages done and the current one running while processing", () => {
    const rows = buildStepperRows({ ...base, status: "processing", stage: "extracting" })
    expect(rows.map((r) => r.state)).toEqual(["completed", "completed", "completed", "running", "pending", "pending"])
  })

  it("prefers logged step status (e.g. a failed OCR step)", () => {
    const rows = buildStepperRows({
      ...base,
      status: "failed",
      stage: "failed",
      steps: [
        { stage: "ocr", status: "failed", message: "unreadable file", started_at: null, finished_at: null },
      ],
    })
    expect(rows.find((r) => r.stage === "ocr")?.state).toBe("failed")
    expect(rows.find((r) => r.stage === "done")?.state).toBe("pending")
  })

  it("shows a failed step as retrying while the document is still queued", () => {
    const rows = buildStepperRows({
      ...base,
      status: "queued",
      stage: "queued",
      steps: [{ stage: "ocr", status: "failed", message: "connection refused", started_at: null, finished_at: null }],
    })
    expect(rows.find((r) => r.stage === "ocr")?.state).toBe("retrying")
  })

  it("completes everything for finished documents", () => {
    const rows = buildStepperRows({ ...base, status: "needs_review", stage: "done" })
    expect(rows.every((r) => r.state === "completed")).toBe(true)
  })
})

describe("ProcessingStepper", () => {
  it("renders step messages", () => {
    render(
      <ProcessingStepper
        doc={{
          ...base,
          status: "processing",
          stage: "classifying",
          steps: [
            { stage: "ocr", status: "completed", message: "2 pages via text_layer", started_at: null, finished_at: "2026-01-12T10:00:00Z" },
          ],
        }}
      />,
    )
    expect(screen.getByText("2 pages via text_layer")).toBeInTheDocument()
    expect(screen.getByText(/Identifying document type/)).toHaveTextContent("running")
  })
})

describe("diffDocumentPatch", () => {
  const original = { title: "Blood test", doc_date: "2026-01-12", doc_type: "lab_report" as const, source: "" }
  it("sends only changed fields, clearing to null", () => {
    expect(diffDocumentPatch(original, { ...original })).toEqual({})
    expect(diffDocumentPatch(original, { ...original, title: "", source: " Apollo " })).toEqual({ title: null, source: "Apollo" })
    expect(diffDocumentPatch(original, { ...original, doc_type: "prescription", doc_date: "" })).toEqual({
      doc_type: "prescription",
      doc_date: null,
    })
  })
})
