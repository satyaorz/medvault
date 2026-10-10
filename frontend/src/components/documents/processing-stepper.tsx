import { AlertCircle, Check, Circle, Loader2, MinusCircle, RotateCw } from "lucide-react"

import { PIPELINE_STAGES, STAGE_LABELS } from "@/lib/constants"
import { formatDateTime } from "@/lib/format"
import type { DocumentDetail, ProcessingStep, StepStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

type VisualState = StepStatus | "pending" | "retrying"

/**
 * Merge the pipeline's fixed stage order with the steps the worker has logged so far.
 * Exported for tests.
 */
export function buildStepperRows(doc: Pick<DocumentDetail, "stage" | "status" | "steps">) {
  const byStage = new Map<string, ProcessingStep>()
  for (const step of doc.steps) byStage.set(step.stage, step) // last write wins (reprocess)
  const currentIndex = PIPELINE_STAGES.indexOf(doc.stage as (typeof PIPELINE_STAGES)[number])
  const terminal = doc.status === "completed" || doc.status === "needs_review"
  const inFlight = doc.status === "queued" || doc.status === "processing"

  return PIPELINE_STAGES.map((stage, index) => {
    const step = byStage.get(stage)
    let state: VisualState
    // A failed step on a document that's still queued/processing is being retried by the worker.
    if (step) state = step.status === "failed" && inFlight ? "retrying" : step.status
    else if (stage === "queued") state = "completed"
    else if (stage === "done") state = terminal ? "completed" : "pending"
    else if (terminal || (currentIndex >= 0 && index < currentIndex)) state = "completed"
    else if (index === currentIndex && doc.status === "processing") state = "running"
    else state = "pending"
    return { stage, label: STAGE_LABELS[stage], state, step }
  })
}

const ICONS: Record<VisualState, typeof Check> = {
  completed: Check,
  running: Loader2,
  failed: AlertCircle,
  skipped: MinusCircle,
  pending: Circle,
  retrying: RotateCw,
}

const DOT_STYLES: Record<VisualState, string> = {
  completed: "bg-success text-success-foreground",
  running: "bg-info text-info-foreground",
  failed: "bg-destructive text-white",
  skipped: "bg-muted text-muted-foreground",
  pending: "border bg-background text-muted-foreground",
  retrying: "bg-warning text-warning-foreground",
}

export function ProcessingStepper({ doc }: { doc: DocumentDetail }) {
  const rows = buildStepperRows(doc)
  return (
    <ol className="relative space-y-0" aria-label="Processing steps">
      {rows.map((row, i) => {
        const Icon = ICONS[row.state]
        return (
          <li key={row.stage} className="relative flex gap-3 pb-5 last:pb-0">
            {i < rows.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  "absolute left-3 top-7 h-[calc(100%-1.75rem)] w-px",
                  row.state === "completed" ? "bg-success/40" : "bg-border",
                )}
              />
            ) : null}
            <span className={cn("relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full", DOT_STYLES[row.state])}>
              <Icon className={cn("size-3.5", row.state === "running" && "animate-spin")} aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className={cn("text-sm font-medium", row.state === "pending" && "text-muted-foreground")}>
                {row.label}
                {row.state === "retrying" ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">retrying…</span> : null}
                <span className="sr-only"> — {row.state}</span>
              </p>
              {row.step?.message ? (
                <p className={cn("text-sm", row.state === "failed" ? "text-destructive" : row.state === "retrying" ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")}>
                  {row.step.message}
                </p>
              ) : null}
              {row.step?.finished_at || row.step?.started_at ? (
                <p className="text-xs text-muted-foreground">{formatDateTime(row.step.finished_at ?? row.step.started_at)}</p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
