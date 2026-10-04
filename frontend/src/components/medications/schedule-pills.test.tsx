import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SchedulePills } from "@/components/medications/schedule-pills"

describe("SchedulePills", () => {
  it("renders morning/afternoon/night with active slots marked", () => {
    render(<SchedulePills schedule="1-0-1" />)
    const list = screen.getByRole("list", { name: "Dosing schedule 1-0-1" })
    const items = Array.from(list.querySelectorAll("li"))
    expect(items.map((li) => li.textContent)).toEqual(["Morning: 1", "Afternoon: none", "Night: 1"])
  })

  it("shows multiples for slots with more than one unit", () => {
    render(<SchedulePills schedule="2-0-1" />)
    expect(screen.getByText("×2")).toBeInTheDocument()
  })

  it("renders nothing for non-schedule strings", () => {
    const { container } = render(<SchedulePills schedule="OD" />)
    expect(container).toBeEmptyDOMElement()
  })
})
