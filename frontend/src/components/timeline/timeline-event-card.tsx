import { ChevronRight } from "lucide-react"
import Link from "next/link"

import { StatusBadge } from "@/components/common/badges"
import { DocTypeIcon } from "@/components/common/doc-type-icon"
import { flagClasses, formatDate } from "@/lib/format"
import { profilePath } from "@/lib/navigation"
import type { TimelineEvent, TimelineHighlight } from "@/lib/types"
import { cn } from "@/lib/utils"

const MAX_CHIPS = 8

function HighlightChip({ h }: { h: TimelineHighlight }) {
  const tone =
    h.kind === "lab_result"
      ? flagClasses(h.flag)
      : h.kind === "medication"
        ? "border-primary/20 bg-primary/5 text-foreground"
        : h.kind === "allergy"
          ? "border-destructive/20 bg-destructive/5"
          : "border-border bg-muted/50"
  return (
    <li className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs", tone)}>
      <span className="font-medium">{h.label}</span>
      {h.value ? <span className="tabular-nums opacity-80">{h.value}</span> : null}
    </li>
  )
}

export function TimelineEventCard({ event, profileId }: { event: TimelineEvent; profileId: string }) {
  const chips = event.highlights.slice(0, MAX_CHIPS)
  const extra = event.highlights.length - chips.length
  const body = (
    <>
      <div className="flex items-start gap-3">
        <DocTypeIcon type={event.type} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-medium group-hover:text-primary">{event.title}</h3>
            {event.status === "needs_review" || event.status === "failed" || event.status === "processing" || event.status === "queued" ? (
              <StatusBadge status={event.status} />
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {formatDate(event.date)}
            {event.subtitle ? ` · ${event.subtitle}` : ""}
          </p>
        </div>
        {event.document_id ? <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
      </div>
      {chips.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Highlights">
          {chips.map((h, i) => (
            <HighlightChip key={`${h.kind}-${h.label}-${i}`} h={h} />
          ))}
          {extra > 0 ? <li className="px-1 text-xs text-muted-foreground">+{extra} more</li> : null}
        </ul>
      ) : null}
    </>
  )
  const className = "group block rounded-xl border bg-card p-4 transition-colors"
  return event.document_id ? (
    <Link
      href={profilePath(profileId, `documents/${event.document_id}`)}
      className={cn(className, "outline-none hover:border-primary/40 hover:bg-accent/30 focus-visible:ring-3 focus-visible:ring-ring/50")}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}
