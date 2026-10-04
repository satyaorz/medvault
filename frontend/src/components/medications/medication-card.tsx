"use client"

import { ChevronDown, Clock, Pill, UtensilsCrossed } from "lucide-react"
import { useState } from "react"

import { MedicationHistory } from "@/components/medications/medication-history"
import { SchedulePills } from "@/components/medications/schedule-pills"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { FORM_LABELS, MEDICATION_STATUS_LABELS } from "@/lib/constants"
import { formatDate, formatDose, formatDuration, frequencyLabel, timingLabel } from "@/lib/format"
import type { Medication, MedicationStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATUS_STYLES: Record<MedicationStatus, string> = {
  active: "bg-success/10 text-success border-success/20",
  course_completed: "bg-muted text-muted-foreground border-border",
  not_in_latest: "bg-warning/15 text-warning-foreground dark:text-warning border-warning/30",
}

export function MedicationStatusBadge({ status }: { status: MedicationStatus }) {
  return (
    <Badge variant="outline" className={STATUS_STYLES[status]}>
      {MEDICATION_STATUS_LABELS[status]}
    </Badge>
  )
}

export function MedicationCard({ medication, profileId }: { medication: Medication; profileId: string }) {
  const [open, setOpen] = useState(false)
  const m = medication.latest
  const dose = formatDose(m.dose_value, m.dose_unit)
  const freq = frequencyLabel(m.frequency_code)
  const timing = timingLabel(m.timing)
  const duration = formatDuration(m.duration_days)
  const past = medication.status !== "active"

  return (
    <Card className={cn("gap-0 py-4", past && "bg-muted/30")}>
      <CardContent className="space-y-3 px-4">
        <div className="flex items-start gap-3">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", past ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
            <Pill className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{medication.generic_name}</h3>
              {dose ? <span className="font-medium tabular-nums">{dose}</span> : null}
              {past ? <MedicationStatusBadge status={medication.status} /> : null}
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {[m.brand_name, m.form ? FORM_LABELS[m.form] : null].filter(Boolean).join(" · ") || m.name_original}
            </p>
          </div>
        </div>

        {medication.status === "not_in_latest" ? (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning-foreground dark:text-warning">
            Not in your latest prescription — confirm with your doctor whether it was stopped.
          </p>
        ) : null}

        <div className="space-y-2 text-sm">
          {freq || m.frequency_code ? (
            <p className="flex items-center gap-2">
              <Clock className="size-4 text-muted-foreground" aria-hidden />
              <span>
                {m.frequency_code ? <span className="font-mono text-xs font-medium">{m.frequency_code}</span> : null}
                {freq ? <span className="ml-1.5">{freq}</span> : null}
              </span>
            </p>
          ) : null}
          <SchedulePills schedule={m.schedule} />
          {timing ? (
            <p className="flex items-center gap-2">
              <UtensilsCrossed className="size-4 text-muted-foreground" aria-hidden /> {timing}
            </p>
          ) : null}
          {m.instructions ? <p className="text-muted-foreground">{m.instructions}</p> : null}
          <p className="text-xs text-muted-foreground">
            Prescribed {formatDate(m.prescribed_at, "—")}
            {duration ? ` · for ${duration}` : ""}
          </p>
        </div>

        {medication.history.length > 0 ? (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
                <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden />
                {open ? "Hide history" : `History (${medication.history.length})`}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <MedicationHistory history={medication.history} profileId={profileId} />
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </CardContent>
    </Card>
  )
}
