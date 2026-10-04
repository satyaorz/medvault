import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react"

import type { Trend } from "@/lib/types"
import { cn } from "@/lib/utils"

const ICONS = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight }
const LABELS = { up: "Increased", down: "Decreased", flat: "Unchanged" }

/** Direction only — whether "up" is good or bad depends on the test, so it stays neutral-coloured. */
export function TrendIndicator({ trend, label, className }: { trend: Trend | null | undefined; label?: string; className?: string }) {
  if (!trend) return null
  const Icon = ICONS[trend]
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums", className)}>
      <Icon className="size-3.5" aria-hidden />
      <span className={label ? undefined : "sr-only"}>{label ?? LABELS[trend]}</span>
    </span>
  )
}
