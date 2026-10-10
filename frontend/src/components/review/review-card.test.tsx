import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewCard } from "@/components/review/review-card"
import { qk } from "@/lib/query-keys"
import type { ReviewItem } from "@/lib/types"
import { renderWithProviders } from "@/test/render"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))

const item: ReviewItem = {
  id: "item-1",
  document_id: "doc-1",
  profile_id: "p1",
  kind: "lab_result",
  data: {
    test_name_original: "HGB",
    canonical_code: "hemoglobin",
    canonical_name: "Hemoglobin",
    value: 1.32,
    value_text: null,
    unit: "g/dL",
    value_original: 1.32,
    unit_original: "g/dL",
    reference_low: 13,
    reference_high: 17,
    flag: "low",
    measured_at: "2026-01-12",
  },
  source_text: "HGB 13.2 g/dL 13.0-17.0",
  confidence: 0.55,
  grounded: false,
  issues: ["value outside plausible range"],
  status: "needs_review",
  reviewed_by: null,
  created_at: "2026-01-12T00:00:00Z",
  reviewed_at: null,
  document: { id: "doc-1", filename: "cbc.pdf", title: null, doc_type: "lab_report", doc_date: "2026-01-12" },
}

afterEach(() => vi.unstubAllGlobals())

describe("ReviewCard", () => {
  it("shows why the item needs review and the source quote", () => {
    renderWithProviders(<ReviewCard item={item} profileId="p1" />)
    expect(screen.getByRole("heading", { name: /Hemoglobin/ })).toBeInTheDocument()
    expect(screen.getByText("value outside plausible range")).toBeInTheDocument()
    expect(screen.getByText("HGB 13.2 g/dL 13.0-17.0")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument()
  })

  it("sends corrected data on Save & accept and removes the item from the queue", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ item: { ...item, status: "accepted" } }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()
    const { client } = renderWithProviders(<ReviewCard item={item} profileId="p1" />)
    client.setQueryData(qk.review("p1"), [item])

    const value = screen.getByLabelText("Value")
    await user.clear(value)
    await user.type(value, "13.2")
    await user.click(screen.getByRole("button", { name: "Save & accept" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/items/item-1")
    expect(init.method).toBe("PATCH")
    const body = JSON.parse(init.body)
    expect(body.action).toBe("accept")
    expect(body.data).toMatchObject({ value: 13.2, flag: "normal", value_original: 1.32 })
    expect(client.getQueryData(qk.review("p1"))).toEqual([])
  })

  it("blocks invalid input without calling the API", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()
    renderWithProviders(<ReviewCard item={item} profileId="p1" />)
    const value = screen.getByLabelText("Value")
    await user.clear(value)
    await user.type(value, "abc")
    await user.click(screen.getByRole("button", { name: "Save & accept" }))
    expect(await screen.findByText("Enter a number")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects without a body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ item: { ...item, status: "rejected" } }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()
    renderWithProviders(<ReviewCard item={item} profileId="p1" />)
    await user.click(screen.getByRole("button", { name: "Reject" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "reject" })
  })
})
