import { format, parseISO } from "date-fns"

import type { TimelineEvent } from "@/lib/types"

export interface TimelineGroup {
  key: string // yyyy-MM
  label: string // "September 2026"
  events: TimelineEvent[]
}

/** Split events into upcoming follow-ups (date ≥ today) and past events grouped by month (newest first). */
export function organizeTimeline(events: TimelineEvent[], today: string): { upcoming: TimelineEvent[]; groups: TimelineGroup[] } {
  const upcoming = events.filter((e) => e.type === "follow_up" && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const upcomingIds = new Set(upcoming.map((e) => e.id))
  const past = events.filter((e) => !upcomingIds.has(e.id)).sort((a, b) => b.date.localeCompare(a.date))

  const groups: TimelineGroup[] = []
  for (const event of past) {
    const key = event.date.slice(0, 7)
    let group = groups.at(-1)
    if (!group || group.key !== key) {
      group = { key, label: format(parseISO(`${key}-01`), "MMMM yyyy"), events: [] }
      groups.push(group)
    }
    group.events.push(event)
  }
  return { upcoming, groups }
}
