import { CalendarClock, FileQuestion, FileText, FlaskConical, Hospital, Pill } from "lucide-react"

import type { DocType } from "@/lib/types"
import { cn } from "@/lib/utils"

const ICONS = {
  prescription: Pill,
  lab_report: FlaskConical,
  discharge_summary: Hospital,
  other: FileText,
  unknown: FileQuestion,
  follow_up: CalendarClock,
} satisfies Record<DocType | "follow_up", unknown>

const TONES: Record<DocType | "follow_up", string> = {
  prescription: "bg-chart-1/15 text-chart-1",
  lab_report: "bg-chart-2/15 text-chart-2",
  discharge_summary: "bg-chart-5/15 text-chart-5",
  other: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
  follow_up: "bg-chart-3/20 text-warning-foreground dark:text-chart-3",
}

export function DocTypeIcon({ type, className }: { type: DocType | "follow_up"; className?: string }) {
  const Icon = ICONS[type]
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", TONES[type], className)}>
      <Icon className="size-4.5" aria-hidden />
    </span>
  )
}
