import { FileText } from "lucide-react"
import Link from "next/link"

import { formatDate, formatDuration, summarizeMedication } from "@/lib/format"
import { profilePath } from "@/lib/navigation"
import type { MedicationEvent } from "@/lib/types"

/** Dose-over-time list (newest first), each row linking back to its prescription. */
export function MedicationHistory({ history, profileId }: { history: MedicationEvent[]; profileId: string }) {
  return (
    <ol className="space-y-1.5 border-l pl-4">
      {history.map((event, i) => {
        const prev = history[i + 1]
        const changed = prev && summarizeMedication(prev) !== summarizeMedication(event)
        return (
          <li key={event.id} className="relative text-sm">
            <span className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-border" aria-hidden />
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <span>
                <span className="text-muted-foreground">{formatDate(event.prescribed_at, "Undated")}</span>
                <span className="mx-1.5 text-muted-foreground">·</span>
                <span className={changed ? "font-medium" : undefined}>{summarizeMedication(event)}</span>
                {event.duration_days ? <span className="text-muted-foreground"> · {formatDuration(event.duration_days)}</span> : null}
                {changed ? <span className="ml-1.5 text-xs text-info">changed</span> : null}
              </span>
              <Link
                href={profilePath(profileId, `documents/${event.document_id}`)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline"
              >
                <FileText className="size-3" aria-hidden />
                {event.name_original ?? "Source"}
              </Link>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
