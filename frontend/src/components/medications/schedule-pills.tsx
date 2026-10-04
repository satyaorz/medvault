import { Moon, Sun, Sunrise, Sunset } from "lucide-react"

import { parseSchedule } from "@/lib/format"
import { cn } from "@/lib/utils"

const ICONS: Record<string, typeof Sun> = { Morning: Sunrise, Afternoon: Sun, Evening: Sunset, Night: Moon }

/** Visualizes "1-0-1" as Morning ✓ · Afternoon – · Night ✓. Renders nothing for non-schedules. */
export function SchedulePills({ schedule, className }: { schedule: string | null | undefined; className?: string }) {
  const slots = parseSchedule(schedule)
  if (!slots) return null
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label={`Dosing schedule ${schedule}`}>
      {slots.map((slot) => {
        const Icon = ICONS[slot.label] ?? Sun
        return (
          <li
            key={slot.label}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
              slot.active ? "border-primary/30 bg-primary/10 text-primary" : "border-dashed text-muted-foreground/70",
            )}
          >
            <Icon className="size-3" aria-hidden />
            {slot.label}
            {slot.active && slot.amount !== "1" ? <span className="font-medium">×{slot.amount}</span> : null}
            <span className="sr-only">{slot.active ? `: ${slot.amount}` : ": none"}</span>
          </li>
        )
      })}
    </ul>
  )
}
